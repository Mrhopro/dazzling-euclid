const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#060913',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Remove default menu for maximum cyberpunk dashboard immersion
  mainWindow.setMenu(null);

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// 1. FILE & METADATA FORENSICS BACKEND
// ==========================================

function calculateGcd(a, b) {
  return b === 0 ? a : calculateGcd(b, a % b);
}

// Custom binary header dimension parser for PNG, JPEG, and GIF formats
function parseImageGeometry(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(100);
    fs.readSync(fd, buffer, 0, 100, 0);

    // PNG format verification & dimension extraction
    if (buffer.readUInt32BE(0) === 0x89504E47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    // GIF format verification & dimension extraction
    if (buffer.toString('ascii', 0, 3) === 'GIF') {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width, height };
    }

    // JPEG format verification & segment parsing
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      const stats = fs.statSync(filePath);
      const maxRead = Math.min(stats.size, 65535); // usually SOF segment is near the start
      const jpegBuf = Buffer.alloc(maxRead);

      const fdJpeg = fs.openSync(filePath, 'r');
      fs.readSync(fdJpeg, jpegBuf, 0, maxRead, 0);
      fs.closeSync(fdJpeg);

      let offset = 2;
      while (offset < maxRead - 8) {
        if (jpegBuf[offset] !== 0xFF) {
          offset++;
          continue;
        }
        const marker = jpegBuf[offset + 1];
        if (marker === 0xD9 || marker === 0xDA) {
          break; // End of Image or Start of Scan
        }
        const length = jpegBuf.readUInt16BE(offset + 2);
        if (marker === 0xC0 || marker === 0xC2) {
          // SOF0 (Baseline) or SOF2 (Progressive)
          const height = jpegBuf.readUInt16BE(offset + 5);
          const width = jpegBuf.readUInt16BE(offset + 7);
          return { width, height };
        }
        offset += 2 + length;
      }
    }
  } catch (err) {
    console.error('Failed to parse image geometry from binary headers:', err);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) {}
    }
  }
  return null;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.zip': 'application/zip',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.exe': 'application/x-msdownload',
    '.dll': 'application/x-msdownload',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css'
  };
  return map[ext] || 'application/octet-stream';
}

ipcMain.handle('analyze-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('File does not exist');
    }

    const stats = fs.statSync(filePath);
    const name = path.basename(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const sizeStr = `${sizeKB} KB (${sizeMB} MB) - ${stats.size} bytes`;
    const mime = getMimeType(filePath);
    const lastModified = stats.mtime ? stats.mtime.toLocaleString() : 'N/A';

    // Read magic bytes (first 8 bytes) via discrete chunk read
    let hex = '';
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(8);
      const bytesRead = fs.readSync(fd, buffer, 0, 8, 0);
      for (let i = 0; i < bytesRead; i++) {
        hex += buffer[i].toString(16).padStart(2, '0').toUpperCase();
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    let verifiedType = 'UNKNOWN / OTHER';
    if (hex.startsWith('89504E47')) {
      verifiedType = 'PNG Image';
    } else if (hex.startsWith('FFD8FF')) {
      verifiedType = 'JPEG Image';
    } else if (hex.startsWith('47494638')) {
      verifiedType = 'GIF Image';
    } else if (hex.startsWith('504B0304')) {
      verifiedType = 'ZIP / Office Archive';
    } else if (hex.startsWith('25504446')) {
      verifiedType = 'PDF Document';
    } else if (hex.startsWith('4D5A')) {
      verifiedType = 'EXE / DLL Executable';
    } else if (hex.startsWith('7B')) {
      verifiedType = 'JSON Document';
    }

    const isImage = mime.startsWith('image/') || 
                    ['PNG Image', 'JPEG Image', 'GIF Image'].includes(verifiedType);

    let width = null;
    let height = null;
    let aspect = null;

    if (isImage) {
      const geometry = parseImageGeometry(filePath);
      if (geometry) {
        width = geometry.width;
        height = geometry.height;
        const divisor = calculateGcd(width, height);
        aspect = divisor > 0 ? `${width / divisor}:${height / divisor}` : 'N/A';
      }
    }

    return {
      success: true,
      name,
      size: sizeStr,
      mime,
      lastModified,
      hex: hex || 'NO DATA',
      type: verifiedType,
      isImage,
      width,
      height,
      aspect
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
});

// ==========================================
// 2. STREAMING CRYPTO HASHER BACKEND
// ==========================================

ipcMain.handle('hash-file', async (event, filePath) => {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(filePath)) {
        return resolve({ success: false, error: 'File does not exist' });
      }

      const sha256 = crypto.createHash('sha256');
      const sha1 = crypto.createHash('sha1');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        sha256.update(chunk);
        sha1.update(chunk);
      });

      stream.on('end', () => {
        resolve({
          success: true,
          sha256: sha256.digest('hex'),
          sha1: sha1.digest('hex')
        });
      });

      stream.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// ==========================================
// 3. MORSE DECODER STATE MACHINE BACKEND
// ==========================================

const MORSE_MAP = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F",
  "--.": "G", "....": "H", "..": "I", ".---": "J", "-.-": "K", ".-..": "L",
  "--": "M", "-.": "N", "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R",
  "...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X",
  "-.--": "Y", "--..": "Z", "-----": "0", ".----": "1", "..---": "2",
  "...--": "3", "....-": "4", ".....": "5", "-....": "6", "--...": "7",
  "---..": "8", "----.": "9", ".-.-.-": ".", "--..--": ",", "---...": ":",
  "..--..": "?", ".----.": "'", "-....-": "-", "-..-.": "/", "-.--.": "(",
  "-.--.-": ")", ".-..-.": "\"", "-...-": "=", ".-.-.": "+", ".--.-.": "@"
};

let morseState = {
  lastSignalState: 'off',
  lastStateChangeTime: 0,
  pendingSignalState: null,
  pendingStateStartTime: 0,
  morseSignalStream: '',
  hasActiveOffGapProcessed: true,
  hasActiveWordGapProcessed: true,
  decodedText: ''
};

function resetMorseState(now) {
  morseState = {
    lastSignalState: 'off',
    lastStateChangeTime: now || 0,
    pendingSignalState: null,
    pendingStateStartTime: 0,
    morseSignalStream: '',
    hasActiveOffGapProcessed: true,
    hasActiveWordGapProcessed: true,
    decodedText: ''
  };
}

ipcMain.handle('process-morse-frame', (event, data) => {
  const { amp, threshold, charWpm, spaceWpm, now, reset, flush } = data;

  if (reset) {
    resetMorseState(now);
    return { text: '', ledOn: false, signalStream: '' };
  }

  if (flush) {
    if (morseState.morseSignalStream.length > 0) {
      const char = MORSE_MAP[morseState.morseSignalStream] || '?';
      morseState.decodedText += char;
      morseState.morseSignalStream = '';
    }
    return {
      text: morseState.decodedText,
      ledOn: false,
      signalStream: ''
    };
  }

  const rawSignalState = amp >= threshold ? 'on' : 'off';
  const ledOn = rawSignalState === 'on';

  // Farnsworth timing configurations
  const charDotTime = 1200 / charWpm;
  const spaceDotTime = 1200 / spaceWpm;

  // Debounce transition handling
  if (rawSignalState !== morseState.lastSignalState) {
    if (rawSignalState !== morseState.pendingSignalState) {
      morseState.pendingSignalState = rawSignalState;
      morseState.pendingStateStartTime = now;
    } else {
      const pendingDuration = now - morseState.pendingStateStartTime;
      const debounceThreshold = (morseState.lastSignalState === 'on') ? 10 : 15;

      if (pendingDuration >= debounceThreshold) {
        const duration = morseState.pendingStateStartTime - morseState.lastStateChangeTime;

        if (morseState.lastSignalState === 'on') {
          const minPulseWidth = Math.max(15, 0.4 * charDotTime);
          if (duration >= minPulseWidth) {
            // Signal transition stable. Identify Dot or Dash
            if (duration < 2.0 * charDotTime) {
              morseState.morseSignalStream += '.';
            } else {
              morseState.morseSignalStream += '-';
            }
          }
        }

        morseState.lastSignalState = morseState.pendingSignalState;
        morseState.lastStateChangeTime = morseState.pendingStateStartTime;
        morseState.hasActiveOffGapProcessed = false;
        morseState.hasActiveWordGapProcessed = false;
      }
    }
  } else {
    morseState.pendingSignalState = null;
  }

  // Handle silence gaps when state is 'off'
  if (morseState.lastSignalState === 'off') {
    const silenceDuration = now - morseState.lastStateChangeTime;

    // Character boundary gap
    if (silenceDuration >= 1.5 * spaceDotTime && !morseState.hasActiveOffGapProcessed) {
      if (morseState.morseSignalStream.length > 0) {
        const char = MORSE_MAP[morseState.morseSignalStream] || '?';
        morseState.decodedText += char;
        morseState.morseSignalStream = '';
      }
      morseState.hasActiveOffGapProcessed = true;
    }

    // Word boundary gap
    if (silenceDuration >= 4.0 * spaceDotTime && !morseState.hasActiveWordGapProcessed) {
      if (morseState.decodedText.length > 0 && !morseState.decodedText.endsWith(' ') && !morseState.decodedText.endsWith('\n')) {
        morseState.decodedText += ' ';
      }
      morseState.hasActiveWordGapProcessed = true;
    }

    // Reset tracking state after 4 seconds of silence
    if (silenceDuration >= 4000) {
      morseState.morseSignalStream = '';
    }
  }

  return {
    text: morseState.decodedText,
    ledOn,
    signalStream: morseState.morseSignalStream
  };
});
