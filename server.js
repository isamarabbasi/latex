require('dotenv').config();

const express = require('express');
const cors = require('cors');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

app.use(cors());
app.use(express.json());

// Configuration (loaded from .env — see .env.example)
const OVERLEAF_GIT_URL = process.env.OVERLEAF_GIT_URL;
const OVERLEAF_REPO_DIR = path.join(__dirname, '.overleaf-repo');
const LATEX_FILENAME = 'sample.tex';
const GOOGLE_DOC_ID = process.env.GOOGLE_DOC_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

// Google Docs API setup
let auth = null;
let docs = null;

let googleAccessToken = null;
const TOKEN_PATH = path.join(__dirname, '.google-token.json');

function initializeGoogleAuth() {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.warn('⚠️ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in .env. Google Docs integration disabled.');
      return false;
    }

    auth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    // Try to load saved token
    if (fs.existsSync(TOKEN_PATH)) {
      const savedToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      auth.setCredentials(savedToken);
      googleAccessToken = savedToken.access_token;
      docs = google.docs({ version: 'v1', auth });
      console.log('✓ Google Docs API initialized with saved token');
      return true;
    }

    console.log('⚠️ No Google authorization token found. Visit: http://localhost:3001/auth/google');
    return false;
  } catch (err) {
    console.warn('⚠️ Google Docs initialization failed:', err.message);
    return false;
  }
}

// ==================== OVERLEAF GIT OPERATIONS ====================

async function initializeOverleafRepo() {
  try {
    if (!OVERLEAF_GIT_URL) {
      throw new Error('OVERLEAF_GIT_URL is not set in .env');
    }
    if (fs.existsSync(OVERLEAF_REPO_DIR)) {
      console.log('Overleaf repo exists, pulling latest changes...');
      const git = simpleGit(OVERLEAF_REPO_DIR);
      try {
        await git.pull('origin', 'master');
      } catch (pullErr) {
        console.log('Pull failed, continuing with existing repo...');
      }
      return git;
    } else {
      console.log('Cloning Overleaf repository...');
      fs.mkdirSync(OVERLEAF_REPO_DIR, { recursive: true });
      const git = simpleGit();

      console.log('Git clone URL:', OVERLEAF_GIT_URL);
      await git.clone(OVERLEAF_GIT_URL, OVERLEAF_REPO_DIR);

      const repoGit = simpleGit(OVERLEAF_REPO_DIR);
      await repoGit.addConfig('pull.rebase', 'false');
      await repoGit.addConfig('user.email', 'resume-optimizer@local');
      await repoGit.addConfig('user.name', 'Resume Optimizer');

      return repoGit;
    }
  } catch (err) {
    console.error('Error initializing Overleaf repo:', err.message);
    throw new Error('Could not access Overleaf repository. Make sure your Git credentials are correct and saved in Git Credential Manager.');
  }
}

async function pushToOverleaf(latexCode) {
  try {
    const git = await initializeOverleafRepo();

    // Write the LaTeX code to sample.tex
    const filePath = path.join(OVERLEAF_REPO_DIR, LATEX_FILENAME);
    fs.writeFileSync(filePath, latexCode, 'utf-8');

    // Stage changes
    await git.add(LATEX_FILENAME);

    // Commit only if there are changes
    const status = await git.status();
    if (status.files.length > 0) {
      await git.commit(`Auto-update resume - ${new Date().toLocaleString()}`);

      // Push to Overleaf
      await git.push('origin', 'master', ['-u']);
    } else {
      console.log('No changes to commit');
    }

    return { success: true, message: 'Successfully pushed to Overleaf!' };
  } catch (err) {
    console.error('Error pushing to Overleaf:', err);
    throw new Error('Failed to push to Overleaf: ' + err.message);
  }
}

// ==================== COVER LETTER OPERATIONS ====================

function findPlaceholderInContent(content, placeholder) {
  for (const element of content) {
    if (element.paragraph && element.paragraph.elements) {
      for (const run of element.paragraph.elements) {
        if (run.textRun && run.textRun.content && run.textRun.content.includes(placeholder)) {
          const offset = run.textRun.content.indexOf(placeholder);
          return {
            startIndex: run.startIndex + offset,
            endIndex: run.startIndex + offset + placeholder.length
          };
        }
      }
    }
    if (element.table && element.table.tableRows) {
      for (const row of element.table.tableRows) {
        if (row.tableCells) {
          for (const cell of row.tableCells) {
            if (cell.content) {
              const found = findPlaceholderInContent(cell.content, placeholder);
              if (found) return found;
            }
          }
        }
      }
    }
  }
  return null;
}

async function updateGoogleDoc(coverLetterText) {
  try {
    if (!docs) {
      throw new Error('Google Docs API not initialized. Make sure GOOGLE_CLIENT_ID/SECRET are set in .env and you have completed /auth/google.');
    }
    if (!GOOGLE_DOC_ID) {
      throw new Error('GOOGLE_DOC_ID is not set in .env');
    }

    const doc = await docs.documents.get({ documentId: GOOGLE_DOC_ID });
    const cleanText = coverLetterText.replace(/\n\s*\n/g, '\n').trim();

    const NR_NAME = 'coverLetterBody';
    const namedRangesMap = doc.data.namedRanges || {};
    const existingNR = namedRangesMap[NR_NAME];

    let startIndex, endIndex, hasNamedRange = false;

    if (existingNR && existingNR.namedRanges && existingNR.namedRanges.length > 0) {
      // Subsequent save: use the tracked named range
      const ranges = existingNR.namedRanges[0].ranges;
      startIndex = ranges[0].startIndex;
      endIndex = ranges[ranges.length - 1].endIndex;
      hasNamedRange = true;
    } else {
      // First save: find the placeholder
      const placeholder = findPlaceholderInContent(doc.data.body.content, '[COVER_LETTER_BODY]');
      if (!placeholder) {
        throw new Error('Placeholder [COVER_LETTER_BODY] not found in Google Doc. Please add it back to the body area of your template.');
      }
      startIndex = placeholder.startIndex;
      endIndex = placeholder.endIndex;
    }

    const requests = [];
    if (hasNamedRange) {
      requests.push({ deleteNamedRange: { name: NR_NAME } });
    }
    requests.push({ deleteContentRange: { range: { startIndex, endIndex } } });
    requests.push({ insertText: { text: cleanText, location: { index: startIndex } } });
    requests.push({
      createNamedRange: {
        name: NR_NAME,
        range: { startIndex: startIndex, endIndex: startIndex + cleanText.length }
      }
    });
    // Apply professional paragraph spacing to the inserted body
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: startIndex, endIndex: startIndex + cleanText.length },
        paragraphStyle: {
          spaceAbove: { magnitude: 0, unit: 'PT' },
          spaceBelow: { magnitude: 10, unit: 'PT' },
          lineSpacing: 115
        },
        fields: 'spaceAbove,spaceBelow,lineSpacing'
      }
    });

    await docs.documents.batchUpdate({
      documentId: GOOGLE_DOC_ID,
      requestBody: { requests }
    });

    return {
      success: true,
      message: `✓ Cover letter updated in Google Doc!`,
      docUrl: `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/edit`
    };
  } catch (err) {
    console.error('Error updating Google Doc:', err.message);
    throw new Error('Failed to update Google Doc: ' + err.message);
  }
}

async function saveCoverLetterToFile(coverLetterText) {
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `cover_letter_${timestamp}.txt`;
    const filepath = path.join(__dirname, filename);

    fs.writeFileSync(filepath, coverLetterText, 'utf-8');

    return {
      success: true,
      filename: filename,
      message: `Cover letter saved as ${filename}`
    };
  } catch (err) {
    console.error('Error saving cover letter:', err);
    throw new Error('Failed to save cover letter: ' + err.message);
  }
}

// ==================== API ENDPOINTS ====================

// Home page
app.get('/', (req, res) => {
  res.json({
    status: '✓ Resume Optimizer Backend is running!',
    port: PORT,
    endpoints: {
      health: 'GET /health',
      overleaf: 'POST /api/send-to-overleaf',
      coverLetter: 'POST /api/save-cover-letter'
    }
  });
});

// Google OAuth endpoints
app.get('/auth/google', (req, res) => {
  if (!auth) {
    return res.status(500).send('Google Auth not initialized');
  }

  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/documents']
  });

  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  try {
    if (!auth) {
      throw new Error('Google Auth not initialized');
    }

    const code = req.query.code;
    if (!code) {
      return res.status(400).send('No authorization code provided');
    }

    console.log('Exchanging authorization code for tokens...');
    const { tokens } = await auth.getToken(code);

    console.log('Setting credentials...');
    auth.setCredentials(tokens);
    googleAccessToken = tokens.access_token;

    console.log('Saving token to file...');
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens), 'utf-8');

    console.log('Initializing Google Docs API...');
    docs = google.docs({ version: 'v1', auth });

    console.log('✓ OAuth authorization successful!');
    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>✓ Authorization successful!</h1>
          <p>You can close this window and go back to the Resume Optimizer tool.</p>
          <p>Google Docs integration is now active!</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 50px;">
          <h1>❌ Authorization failed</h1>
          <p>${err.message}</p>
        </body>
      </html>
    `);
  }
});

// Debug: Get document content
app.get('/debug/doc-content', async (req, res) => {
  try {
    if (!docs) {
      return res.json({ error: 'Google Docs API not initialized' });
    }

    const doc = await docs.documents.get({ documentId: GOOGLE_DOC_ID });
    const textContent = [];

    for (const element of doc.data.body.content) {
      if (element.paragraph && element.paragraph.elements) {
        for (const run of element.paragraph.elements) {
          if (run.textRun) {
            textContent.push({
              text: run.textRun.content,
              startIndex: run.startIndex,
              endIndex: run.endIndex
            });
          }
        }
      }
    }

    res.json({
      docId: GOOGLE_DOC_ID,
      totalElements: doc.data.body.content.length,
      textContent: textContent,
      placeholderFound: textContent.some(t => t.text.includes('[COVER_LETTER_BODY]'))
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running on port ' + PORT });
});

// Send resume to Overleaf
app.post('/api/send-to-overleaf', async (req, res) => {
  try {
    const { latexCode } = req.body;
    if (!latexCode) {
      return res.status(400).json({ error: 'No LaTeX code provided' });
    }

    const result = await pushToOverleaf(latexCode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save cover letter (to Google Doc or file)
app.post('/api/save-cover-letter', async (req, res) => {
  try {
    const { coverLetterText } = req.body;
    if (!coverLetterText) {
      return res.status(400).json({ error: 'No cover letter text provided' });
    }

    // Reinitialize Google Docs if token file exists and docs isn't initialized
    if (!docs && fs.existsSync(TOKEN_PATH)) {
      console.log('Reinitializing Google Docs API with saved token...');
      try {
        const savedToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        if (auth) {
          auth.setCredentials(savedToken);
          docs = google.docs({ version: 'v1', auth });
          console.log('✓ Google Docs API reinitialized');
        }
      } catch (initErr) {
        console.error('Failed to reinitialize:', initErr.message);
      }
    }

    // Try to update Google Doc first
    try {
      const result = await updateGoogleDoc(coverLetterText);
      return res.json(result);
    } catch (googleErr) {
      console.log('Google Docs update failed, falling back to file save:', googleErr.message);
      // Fall back to saving as file
      const result = await saveCoverLetterToFile(coverLetterText);
      res.json({
        ...result,
        warning: 'Google Doc update failed. Saved to file instead: ' + googleErr.message
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✓ Resume Optimizer Backend running on http://localhost:${PORT}`);
  console.log(`\nConfiguration (from .env):`);
  console.log(`- Overleaf Git URL: ${OVERLEAF_GIT_URL || '(not set — Overleaf push disabled)'}`);
  console.log(`- LaTeX file: ${LATEX_FILENAME}`);
  console.log(`- Google Doc ID: ${GOOGLE_DOC_ID || '(not set — Google Doc save disabled)'}`);
  console.log(`- Google OAuth: ${GOOGLE_CLIENT_ID ? 'configured' : '(not set — Google Docs disabled)'}`);
  console.log(`- Cover letter saves to: ${__dirname}\n`);

  // Initialize Google Auth
  initializeGoogleAuth();

  console.log(`Ready to receive requests from the browser tool!`);
});
