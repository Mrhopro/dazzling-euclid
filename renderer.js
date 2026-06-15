
    // ==========================================
    // AUDIO VISUALIZER GLOBAL STATE
    // ==========================================
    let visualizerAudioCtx = null;
    let visualizerAnalyser = null;
    let visualizerSource = null; // Persistent file player source node
    let visualizerMicSource = null; // Temporary microphone stream source node
    let visualizerMicStream = null;
    let visualizerAnimationId = null;
    let isMicActive = false;
    let audioPlayer = new Audio();
    let isAudioPlaying = false;
    let currentVisualizerMode = 'bars';
    let canvas = null;
    let ctx = null;
    
    // Spectrogram Controls
    let spectrogramScrollSpeed = 2;
    let spectrogramGain = 1.5;
    let spectrogramRangeMode = 'full';

    // ==========================================
    // MORSE CODE GLOBAL STATE
    // ==========================================
    let isPlayingMorse = false;

    // MORSE DECODER GLOBAL STATE
    let isMorseDecoding = false;
    let lastSignalState = 'off';
    let lastStateChangeTime = 0;
    let pendingSignalState = null;
    let pendingStateStartTime = 0;
    let morseSignalStream = '';
    let morseUnitT = 120; // Default WPM unit duration (ms)
    let hasActiveOffGapProcessed = false;
    let hasActiveWordGapProcessed = false;

    // XOR CIPHER STATE
    let xorKeyMode = 'text';

    // STEGO STATE
    let stegoHideImage = null;
    let stegoExtractImage = null;

    // ==========================================
    // GLOBAL APP STATE & ROUTER
    // ==========================================
    const state = {
      activeTab: 'magic',
    };

    // Mobile Menu elements
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobile-overlay');
    const menuIconPath = document.getElementById('menu-icon-path');

    // Toggle menu state
    function toggleMobileMenu(isOpen) {
      if (isOpen) {
        sidebar.classList.remove('-translate-x-full');
        mobileOverlay.classList.remove('hidden');
        menuIconPath.setAttribute('d', 'M6 18L18 6M6 6l12 12');
      } else {
        sidebar.classList.add('-translate-x-full');
        mobileOverlay.classList.add('hidden');
        menuIconPath.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
      }
    }

    mobileMenuToggle.addEventListener('click', () => {
      const isOpen = !sidebar.classList.contains('-translate-x-full');
      toggleMobileMenu(!isOpen);
    });

    mobileOverlay.addEventListener('click', () => {
      toggleMobileMenu(false);
    });

    // Tab buttons event binding
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        switchTab(tabId);
        toggleMobileMenu(false); // Close mobile menu if open
      });
    });

    function switchTab(tabId) {
      state.activeTab = tabId;

      // Hide all contents
      document.querySelectorAll('.tab-content').forEach(panel => {
        panel.classList.add('hidden');
      });

      // Show targeted content
      const targetPanel = document.getElementById(`tab-content-${tabId}`);
      if (targetPanel) {
        targetPanel.classList.remove('hidden');
      }

      // Update button highlights
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('tab-btn-active');
      });
      document.querySelectorAll(`.tab-btn[data-tab="${tabId}"]`).forEach(btn => {
        btn.classList.add('tab-btn-active');
      });

      // Stop Audio visualizer updates if not viewing visualizer tab AND Morse decoding is inactive
      if (tabId === 'visualizer' || isMorseDecoding) {
        if ((isMicActive || isAudioPlaying) && visualizerAnalyser) {
          if (visualizerAnimationId) cancelAnimationFrame(visualizerAnimationId);
          renderLoop();
        }
        if (tabId === 'visualizer') {
          setTimeout(resizeCanvas, 50);
        }
      } else {
        if (visualizerAnimationId) {
          cancelAnimationFrame(visualizerAnimationId);
          visualizerAnimationId = null;
        }
      }

      // Stop Morse audio playback if switching away from Morse Coder
      if (tabId !== 'morse') {
        if (isPlayingMorse) {
          stopMorseAudio();
        }
      }
    }

    // Set Default Tab
    switchTab('magic');

    // ==========================================
    // ALGORITHMS (ENCRYPTIONS, CODERS)
    // ==========================================

    const CAESAR_ALPHABETS = {
      english: {
        upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        lower: "abcdefghijklmnopqrstuvwxyz"
      },
      ukrainian: {
        upper: "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ",
        lower: "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя"
      },
      russian: {
        upper: "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
        lower: "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
      }
    };

    // CAESAR
    function runCaesar(text, shift, action, mode = 'english', direction = 'forward') {
      if (!text) return '';

      let S = parseInt(shift, 10) || 0;
      let opShift = direction === 'backward' ? -S : S;

      if (action === 'decrypt') {
        opShift = -opShift;
      }

      if (mode === 'ascii') {
        const n = 95;
        return text.split('').map(char => {
          const code = char.charCodeAt(0);
          if (code >= 32 && code <= 126) {
            let newIdx = (code - 32 + opShift) % n;
            if (newIdx < 0) newIdx += n;
            return String.fromCharCode(newIdx + 32);
          }
          return char;
        }).join('');
      }

      const alphabet = CAESAR_ALPHABETS[mode] || CAESAR_ALPHABETS.english;
      const upperMap = alphabet.upper;
      const lowerMap = alphabet.lower;
      const n = upperMap.length;

      return text.split('').map(char => {
        const idxUpper = upperMap.indexOf(char);
        if (idxUpper !== -1) {
          let newIdx = (idxUpper + opShift) % n;
          if (newIdx < 0) newIdx += n;
          return upperMap[newIdx];
        }
        const idxLower = lowerMap.indexOf(char);
        if (idxLower !== -1) {
          let newIdx = (idxLower + opShift) % n;
          if (newIdx < 0) newIdx += n;
          return lowerMap[newIdx];
        }
        return char;
      }).join('');
    }

    // VIGENERE
    function runVigenere(text, key, action) {
      if (!text) return '';
      if (!key) return text;
      
      key = key.toUpperCase().replace(/[^A-Z]/g, '');
      if (key.length === 0) return text;

      let keyIndex = 0;
      return text.split('').map(char => {
        let code = char.charCodeAt(0);
        let isUpper = code >= 65 && code <= 90;
        let isLower = code >= 97 && code <= 122;

        if (isUpper || isLower) {
          let base = isUpper ? 65 : 97;
          let shift = key.charCodeAt(keyIndex % key.length) - 65;
          if (action === 'decrypt') {
            shift = (26 - shift) % 26;
          }
          keyIndex++;
          return String.fromCharCode(((code - base + shift) % 26) + base);
        }
        return char;
      }).join('');
    }

    // A1Z26
    function encodeA1Z26(text, sep) {
      if (!text) return '';
      let words = text.trim().split(/\s+/);
      return words.map(word => {
        let letters = [];
        for (let char of word) {
          let code = char.toUpperCase().charCodeAt(0);
          if (code >= 65 && code <= 90) {
            letters.push(code - 64);
          } else {
            // Keep symbol or leave blank
            if (char) letters.push(char);
          }
        }
        return letters.join(sep);
      }).join(' / ');
    }

    function decodeA1Z26(encoded, sep) {
      if (!encoded) return '';
      let words = encoded.split(/\s*\/\s*/);
      return words.map(word => {
        let tokens = word.split(sep);
        return tokens.map(token => {
          let num = parseInt(token, 10);
          if (!isNaN(num) && num >= 1 && num <= 26) {
            return String.fromCharCode(num + 64);
          }
          return token; // Leave symbol
        }).join('');
      }).join(' ');
    }

    // MORSE DICTIONARY
    const MORSE_CODE_MAP = {
      'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.', 'H': '....',
      'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---', 'P': '.--.',
      'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
      'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....',
      '6': '-....', '7': '--...', '8': '---..', '9': '----.', '0': '-----',
      '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.',
      '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
      '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
    };

    const REVERSE_MORSE_MAP = {};
    for (let key in MORSE_CODE_MAP) {
      REVERSE_MORSE_MAP[MORSE_CODE_MAP[key]] = key;
    }
    REVERSE_MORSE_MAP['/'] = ' ';

    function encodeMorse(text) {
      if (!text) return '';
      return text.toUpperCase().split('').map(char => {
        if (char === ' ') return '/';
        return MORSE_CODE_MAP[char] || char;
      }).join(' ');
    }

    function decodeMorse(morse) {
      if (!morse) return '';
      let words = morse.trim().split(/\s*\/\s*|\s{3,}/);
      return words.map(word => {
        let chars = word.split(/\s+/);
        return chars.map(char => {
          return REVERSE_MORSE_MAP[char] || '?';
        }).join('');
      }).join(' ');
    }

    // HEX CODER
    function encodeHex(text, sep) {
      if (!text) return '';
      let hexArray = [];
      for (let i = 0; i < text.length; i++) {
        let hex = text.charCodeAt(i).toString(16).padStart(2, '0');
        hexArray.push(hex);
      }
      if (sep === 'colon') return hexArray.join(':');
      if (sep === 'none') return hexArray.join('');
      if (sep === '0x') return hexArray.map(h => '0x' + h).join(' ');
      return hexArray.join(' ');
    }

    function decodeHex(hexStr) {
      if (!hexStr) return '';
      // Strip formatting variables
      let cleaned = hexStr.replace(/0x/gi, '').replace(/[\s:-]/g, '');
      cleaned = cleaned.replace(/[^0-9a-fA-F]/g, '');
      
      const warningBadge = document.getElementById('hex-odd-warning');
      const isOdd = cleaned.length % 2 !== 0;

      if (warningBadge) {
        if (isOdd) {
          warningBadge.classList.remove('hidden');
        } else {
          warningBadge.classList.add('hidden');
        }
      }

      if (isOdd) {
        cleaned = cleaned + '0'; // Pad trailing zero
      }

      let result = '';
      for (let i = 0; i < cleaned.length; i += 2) {
        let byteStr = cleaned.substr(i, 2);
        let byte = parseInt(byteStr, 16);
        if (!isNaN(byte)) {
          result += String.fromCharCode(byte);
        }
      }
      return result;
    }

    // BINARY CODER
    function encodeBinary(text, isSpaced) {
      if (!text) return '';
      let binaryArray = [];
      for (let i = 0; i < text.length; i++) {
        let bin = text.charCodeAt(i).toString(2).padStart(8, '0');
        binaryArray.push(bin);
      }
      return isSpaced ? binaryArray.join(' ') : binaryArray.join('');
    }

    function decodeBinary(binStr) {
      if (!binStr) return '';
      let cleaned = binStr.replace(/[^01]/g, '');
      
      const warningBadge = document.getElementById('binary-chunk-warning');
      const remainder = cleaned.length % 8;
      const isIncorrectLength = remainder !== 0;

      if (warningBadge) {
        if (isIncorrectLength) {
          warningBadge.classList.remove('hidden');
        } else {
          warningBadge.classList.add('hidden');
        }
      }

      let result = '';
      for (let i = 0; i < cleaned.length; i += 8) {
        let byteStr = cleaned.substr(i, 8);
        if (byteStr.length < 8) {
          byteStr = byteStr.padStart(8, '0');
        }
        let byte = parseInt(byteStr, 2);
        if (!isNaN(byte)) {
          result += String.fromCharCode(byte);
        }
      }
      return result;
    }

    // ==========================================
    // MAGIC AUTO-DETECTION MODULE
    // ==========================================
    const magicInput = document.getElementById('magic-input');
    const magicResults = document.getElementById('magic-results-container');

    magicInput.addEventListener('input', runMagicDecode);

    function runMagicDecode() {
      const text = magicInput.value.trim();
      magicResults.innerHTML = '';

      if (!text) {
        magicResults.innerHTML = `
          <div class="border border-dashed border-cyberBorder p-8 text-center rounded text-slate-500 font-mono text-sm">
            Waiting for input data...
          </div>
        `;
        return;
      }

      const matches = detectFormats(text);

      if (matches.length === 0) {
        magicResults.innerHTML = `
          <div class="border border-cyberMagenta/20 bg-cyberMagenta/5 p-5 text-center rounded text-cyberMagenta font-mono text-xs uppercase tracking-wider">
            NO STANDARD ENCODINGS DETECTED IN THIS RAW STRING
          </div>
        `;
        return;
      }

      matches.forEach(match => {
        const preview = match.decoded.length > 200 ? match.decoded.substring(0, 200) + '...' : match.decoded;
        const card = document.createElement('div');
        card.className = "cyber-panel p-4 rounded-lg border border-cyberCyan/30 hover:border-cyberCyan/70 transition shadow-[0_0_10px_rgba(0,240,255,0.02)] flex flex-col md:flex-row justify-between items-start md:items-center gap-4";
        
        if (match.type === 'barline') {
          card.innerHTML = `
            <div class="flex-1 min-w-0">
              <span class="text-[10px] uppercase font-mono tracking-widest text-cyberCyan px-2 py-0.5 bg-cyberCyan/10 border border-cyberCyan/20 rounded font-bold">Detected Musical Barline Cipher!</span>
              <div class="mt-2.5">
                <span class="text-[10px] uppercase font-mono text-slate-500 block">DECODED RESULT PREVIEW:</span>
                <pre class="text-xs text-slate-200 mt-1 font-mono bg-[#070b13] p-3 rounded border border-cyberBorder overflow-x-auto break-all whitespace-pre-wrap">${escapeHTML(preview)}</pre>
              </div>
            </div>
            <button class="action-switch-btn shrink-0 w-full md:w-auto px-4 py-2 border border-cyberCyan text-cyberCyan font-mono text-xs uppercase tracking-wider rounded bg-cyberCyan/10 hover:bg-cyberCyan/20 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(0,240,255,0.15)]">
              Load in Barline Decoder
            </button>
          `;
        } else {
          card.innerHTML = `
            <div class="flex-1 min-w-0">
              <span class="text-[10px] uppercase font-mono tracking-widest text-cyberCyan px-2 py-0.5 bg-cyberCyan/10 border border-cyberCyan/20 rounded font-bold">${match.typeName} detected</span>
              <div class="mt-2.5">
                <span class="text-[10px] uppercase font-mono text-slate-500 block">DECODED RESULT PREVIEW:</span>
                <pre class="text-xs text-slate-200 mt-1 font-mono bg-[#070b13] p-3 rounded border border-cyberBorder overflow-x-auto break-all whitespace-pre-wrap">${escapeHTML(preview)}</pre>
              </div>
            </div>
            <button class="action-switch-btn shrink-0 w-full md:w-auto px-4 py-2 border border-cyberCyan text-cyberCyan font-mono text-xs uppercase tracking-wider rounded bg-cyberCyan/10 hover:bg-cyberCyan/20 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(0,240,255,0.15)]">
              LOAD IN TOOL
            </button>
          `;
        }
        
        // Bind event handler programmatically to avoid any quoting issues
        const switchBtn = card.querySelector('.action-switch-btn');
        switchBtn.addEventListener('click', () => {
          applyMagicSwitch(match.type, text);
        });

        magicResults.appendChild(card);
      });
    }

    function detectFormats(text) {
      let results = [];
      let stripped = text.trim();

      // 1. Binary Detection
      const binaryClean = stripped.replace(/[^01]/g, '');
      const isBinaryOnly = /^[01\s]+$/.test(stripped);
      if (isBinaryOnly && binaryClean.length >= 8) {
        try {
          let decoded = decodeBinary(stripped);
          if (isPrintable(decoded) && decoded.length > 0) {
            results.push({ type: 'binary', typeName: 'Binary', decoded });
          }
        } catch (e) {}
      }

      // 2. Morse Detection
      const isMorseOnly = /^[.\-\/\s]+$/.test(stripped);
      const hasMorseChars = /[.\-]/.test(stripped);
      if (isMorseOnly && hasMorseChars && stripped.length >= 3) {
        try {
          let decoded = decodeMorse(stripped);
          if (decoded.replace(/\?/g, '').trim().length > 0) {
            results.push({ type: 'morse', typeName: 'Morse Code', decoded });
          }
        } catch (e) {}
      }

      // 3. HEX Detection
      let hexClean = stripped.replace(/0x/gi, '').replace(/\\x/gi, '').replace(/[\s:-]/g, '');
      const isHexOnly = /^[0-9a-fA-F]+$/.test(hexClean);
      if (isHexOnly && hexClean.length >= 4 && hexClean.length % 2 === 0) {
        try {
          let decoded = decodeHex(stripped);
          if (isPrintable(decoded) && decoded.length > 0) {
            results.push({ type: 'hex', typeName: 'HEX (Hexadecimal)', decoded });
          }
        } catch (e) {}
      }

      // 4. Base64 Detection
      const b64Clean = stripped.replace(/\s/g, '');
      const isB64Chars = /^[A-Za-z0-9+/=]+$/.test(b64Clean);
      if (isB64Chars && b64Clean.length >= 4 && (b64Clean.length % 4 === 0 || b64Clean.includes('='))) {
        try {
          let decoded = atob(b64Clean);
          if (isPrintable(decoded) && decoded !== stripped) {
            results.push({ type: 'base64', typeName: 'Base64', decoded });
          }
        } catch (e) {}
      }

      // 5. URL Encoding Detection
      const hasPercentEncoding = /%[0-9a-fA-F]{2}/.test(stripped);
      if (hasPercentEncoding) {
        try {
          let decoded = decodeURIComponent(stripped);
          if (decoded !== stripped) {
            results.push({ type: 'url', typeName: 'URL Encoding', decoded });
          }
        } catch (e) {}
      }

      // 6. Barline Cipher Detection
      const hasBarline = /[\u{1D100}-\u{1D103}]/u.test(stripped);
      if (hasBarline) {
        try {
          let decoded = runBarlineSmartDecodeQuiet(stripped);
          results.push({ type: 'barline', typeName: 'Musical Barline Cipher', decoded });
        } catch (e) {}
      }

      return results;
    }

    function isPrintable(str) {
      if (!str) return false;
      let printableCount = 0;
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
          printableCount++;
        }
      }
      return (printableCount / str.length) >= 0.8;
    }

    function applyMagicSwitch(type, rawText) {
      if (type === 'base64') {
        switchTab('base64');
        setBase64Subtab('base64');
        document.getElementById('b64-direction-toggle').checked = true; // Decode
        document.getElementById('b64-input').value = rawText;
        runBase64Conversion();
      } else if (type === 'url') {
        switchTab('base64');
        setBase64Subtab('url');
        document.getElementById('b64-direction-toggle').checked = true; // Decode
        document.getElementById('b64-input').value = rawText;
        runBase64Conversion();
      } else if (type === 'hex') {
        switchTab('hex');
        document.getElementById('hex-direction-decode').click();
        document.getElementById('hex-input').value = rawText;
        runHexConversion();
      } else if (type === 'binary') {
        switchTab('binary');
        document.getElementById('binary-direction-decode').click();
        document.getElementById('binary-input').value = rawText;
        runBinaryConversion();
      } else if (type === 'morse') {
        switchTab('morse');
        document.getElementById('morse-direction-decode').click();
        document.getElementById('morse-input').value = rawText;
        runMorseConversion();
      } else if (type === 'barline') {
        switchTab('barline');
        document.getElementById('barline-input').value = rawText;
        runBarlineDecode();
      }
    }

    // Escape helpers
    function escapeHTML(str) {
      return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
      );
    }

    // Double escape strings that go into onclick attributes in HTML
    function escapeJSString(str) {
      return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/"/g, '\\"');
    }

    // ==========================================
    // BASE64 & URL TAB MODULE
    // ==========================================
    let activeB64Subtab = 'base64'; 
    const b64SubtabBase64 = document.getElementById('b64-subtab-base64');
    const b64SubtabUrl = document.getElementById('b64-subtab-url');
    const b64Input = document.getElementById('b64-input');
    const b64Output = document.getElementById('b64-output');
    const b64Direction = document.getElementById('b64-direction-toggle');
    const b64Error = document.getElementById('b64-error-banner');

    function setBase64Subtab(tab) {
      activeB64Subtab = tab;
      if (tab === 'base64') {
        b64SubtabBase64.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all bg-cyberCyan/10 text-cyberCyan border border-cyberCyan/20";
        b64SubtabUrl.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all text-slate-400 hover:text-white";
        b64Input.placeholder = "Enter text or Base64 code...";
      } else {
        b64SubtabUrl.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all bg-cyberCyan/10 text-cyberCyan border border-cyberCyan/20";
        b64SubtabBase64.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all text-slate-400 hover:text-white";
        b64Input.placeholder = "Enter URL encoded characters or plaintext...";
      }
      runBase64Conversion();
    }

    b64SubtabBase64.addEventListener('click', () => setBase64Subtab('base64'));
    b64SubtabUrl.addEventListener('click', () => setBase64Subtab('url'));
    b64Input.addEventListener('input', runBase64Conversion);
    b64Direction.addEventListener('change', runBase64Conversion);

    function runBase64Conversion() {
      const text = b64Input.value;
      const isDecode = b64Direction.checked;
      b64Error.classList.add('hidden');
      b64Input.classList.remove('border-cyberMagenta', 'shadow-magenta-glow');

      if (!text) {
        b64Output.value = '';
        return;
      }

      if (activeB64Subtab === 'base64') {
        if (isDecode) {
          try {
            const cleanText = text.replace(/\s/g, '');
            b64Output.value = atob(cleanText);
          } catch (e) {
            b64Output.value = '';
            b64Error.classList.remove('hidden');
            b64Input.classList.add('border-cyberMagenta', 'shadow-magenta-glow');
          }
        } else {
          try {
            b64Output.value = btoa(text);
          } catch(e) {
            b64Output.value = '';
            b64Error.textContent = "ERROR: Failed to encode characters. Direct binary streams may trigger exceptions.";
            b64Error.classList.remove('hidden');
          }
        }
      } else {
        if (isDecode) {
          try {
            b64Output.value = decodeURIComponent(text);
          } catch (e) {
            b64Output.value = '';
            b64Error.textContent = "ERROR: String contains malformed URL structures.";
            b64Error.classList.remove('hidden');
            b64Input.classList.add('border-cyberMagenta', 'shadow-magenta-glow');
          }
        } else {
          b64Output.value = encodeURIComponent(text);
        }
      }
    }

    // ==========================================
    // CAESAR CIPHER TAB MODULE
    // ==========================================
    const caesarInput = document.getElementById('caesar-input');
    const caesarOutput = document.getElementById('caesar-output');
    const caesarModeEncrypt = document.getElementById('caesar-mode-encrypt');
    const caesarModeDecrypt = document.getElementById('caesar-mode-decrypt');
    const caesarShiftSlider = document.getElementById('caesar-shift-slider');
    const caesarShiftNumber = document.getElementById('caesar-shift-number');
    const caesarAlphabetMode = document.getElementById('caesar-alphabet-mode');
    const caesarBruteBtn = document.getElementById('caesar-brute-btn');
    const caesarBruteList = document.getElementById('caesar-brute-list');
    const caesarDirForward = document.getElementById('caesar-dir-forward');
    const caesarDirBackward = document.getElementById('caesar-dir-backward');
    const caesarExportBtn = document.getElementById('caesar-export-btn');

    let caesarDirection = 'encrypt'; 
    let caesarShiftDirection = 'forward';

    caesarModeEncrypt.addEventListener('click', () => {
      caesarDirection = 'encrypt';
      caesarModeEncrypt.className = "flex-1 py-2 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      caesarModeDecrypt.className = "flex-1 py-2 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      runCaesarConversion();
    });

    caesarModeDecrypt.addEventListener('click', () => {
      caesarDirection = 'decrypt';
      caesarModeDecrypt.className = "flex-1 py-2 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      caesarModeEncrypt.className = "flex-1 py-2 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      runCaesarConversion();
    });

    caesarDirForward.addEventListener('click', () => {
      caesarShiftDirection = 'forward';
      caesarDirForward.className = "flex-1 py-2 font-mono text-[10px] uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      caesarDirBackward.className = "flex-1 py-2 font-mono text-[10px] uppercase transition-all text-slate-400 hover:text-white";
      runCaesarConversion();
    });

    caesarDirBackward.addEventListener('click', () => {
      caesarShiftDirection = 'backward';
      caesarDirBackward.className = "flex-1 py-2 font-mono text-[10px] uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      caesarDirForward.className = "flex-1 py-2 font-mono text-[10px] uppercase transition-all text-slate-400 hover:text-white";
      runCaesarConversion();
    });

    caesarInput.addEventListener('input', () => {
      runCaesarConversion();
      updateCaesarBruteForce();
    });

    caesarShiftSlider.addEventListener('input', () => {
      caesarShiftNumber.value = caesarShiftSlider.value;
      runCaesarConversion();
    });

    function getCaesarMaxShift() {
      const mode = caesarAlphabetMode.value;
      if (mode === 'ascii') return 94;
      const alphabet = CAESAR_ALPHABETS[mode] || CAESAR_ALPHABETS.english;
      return alphabet.upper.length - 1;
    }

    caesarAlphabetMode.addEventListener('change', () => {
      const maxShift = getCaesarMaxShift();
      caesarShiftSlider.max = maxShift;
      caesarShiftNumber.max = maxShift;

      const label = document.getElementById('caesar-shift-label');
      if (label) {
        label.textContent = `Shift Offset (1-${maxShift})`;
      }

      let val = parseInt(caesarShiftNumber.value, 10) || 3;
      if (val > maxShift) val = maxShift;
      if (val < 1) val = 1;
      caesarShiftNumber.value = val;
      caesarShiftSlider.value = val;

      runCaesarConversion();
      updateCaesarBruteForce();
    });

    caesarShiftNumber.addEventListener('input', () => {
      let val = parseInt(caesarShiftNumber.value, 10);
      const maxShift = getCaesarMaxShift();
      if (!isNaN(val)) {
        if (val < 1) val = 1;
        if (val > maxShift) val = maxShift;
        caesarShiftSlider.value = val;
        runCaesarConversion();
      }
    });

    caesarShiftNumber.addEventListener('blur', () => {
      let val = parseInt(caesarShiftNumber.value, 10);
      const maxShift = getCaesarMaxShift();
      if (isNaN(val) || val < 1) val = 1;
      if (val > maxShift) val = maxShift;
      caesarShiftNumber.value = val;
      caesarShiftSlider.value = val;
      runCaesarConversion();
    });

    caesarBruteBtn.addEventListener('click', updateCaesarBruteForce);

    caesarExportBtn.addEventListener('click', () => {
      const text = caesarInput.value;
      if (!text) {
        alert("Please enter input text before exporting.");
        return;
      }

      const mode = caesarAlphabetMode.value;
      const alphabetName = caesarAlphabetMode.options[caesarAlphabetMode.selectedIndex].text;
      const maxShift = getCaesarMaxShift();

      const exportData = {
        metadata: {
          timestamp: new Date().toISOString(),
          alphabetMode: alphabetName,
          originalInput: text
        },
        shifts: []
      };

      for (let s = 0; s <= maxShift; s++) {
        const shiftedText = runCaesar(text, s, caesarDirection, mode, caesarShiftDirection);
        exportData.shifts.push({
          shift: s,
          direction: caesarShiftDirection,
          text: shiftedText
        });
      }

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'caesar_bruteforce_export.json';
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    function runCaesarConversion() {
      const text = caesarInput.value;
      const shift = parseInt(caesarShiftNumber.value, 10) || 0;
      const mode = caesarAlphabetMode.value;
      caesarOutput.value = runCaesar(text, shift, caesarDirection, mode, caesarShiftDirection);
    }

    function updateCaesarBruteForce() {
      const text = caesarInput.value.trim();
      caesarBruteList.innerHTML = '';

      if (!text) {
        caesarBruteList.innerHTML = `
          <div class="text-center text-slate-600 py-12">
            Awaiting input to generate brute force list...
          </div>
        `;
        return;
      }

      const mode = caesarAlphabetMode.value;
      const maxShift = getCaesarMaxShift();

      const title = document.getElementById('caesar-brute-title');
      if (title) {
        title.textContent = `ALL ${maxShift} SHIFTS`;
      }

      for (let s = 1; s <= maxShift; s++) {
        let dec = runCaesar(text, s, 'decrypt', mode, caesarShiftDirection);
        let item = document.createElement('div');
        item.className = "border border-cyberBorder hover:border-cyberMagenta/40 bg-[#0c101b] p-2.5 rounded flex flex-col gap-1.5 transition";
        item.innerHTML = `
          <div class="flex justify-between items-center border-b border-cyberBorder/50 pb-1">
            <span class="text-cyberMagenta font-bold uppercase tracking-wider text-[10px]">Shift -${s}</span>
            <button onclick="applyCaesarShift(${s})" class="text-[9px] font-bold text-cyberCyan hover:underline">APPLY</button>
          </div>
          <div class="break-all whitespace-pre-wrap line-clamp-2 text-slate-300 font-mono text-[11px]">${escapeHTML(dec)}</div>
        `;
        caesarBruteList.appendChild(item);
      }
    }

    function applyCaesarShift(shift) {
      caesarShiftSlider.value = shift;
      caesarShiftNumber.value = shift;
      caesarModeDecrypt.click();
    }

    window.applyCaesarShift = applyCaesarShift;

    // ==========================================
    // VIGENERE & A1Z26 TAB MODULE
    // ==========================================
    const vigInput = document.getElementById('vig-input');
    const vigKey = document.getElementById('vig-key');
    const vigOutput = document.getElementById('vig-output');
    const vigModeEncrypt = document.getElementById('vig-mode-encrypt');
    const vigModeDecrypt = document.getElementById('vig-mode-decrypt');
    let vigDirection = 'encrypt';

    const a1Input = document.getElementById('a1-input');
    const a1Separator = document.getElementById('a1-separator');
    const a1Output = document.getElementById('a1-output');
    const a1DirectionEncode = document.getElementById('a1-direction-encode');
    const a1DirectionDecode = document.getElementById('a1-direction-decode');
    let a1Direction = 'encode';

    vigModeEncrypt.addEventListener('click', () => {
      vigDirection = 'encrypt';
      vigModeEncrypt.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      vigModeDecrypt.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all text-slate-400 hover:text-white";
      runVigenereConversion();
    });

    vigModeDecrypt.addEventListener('click', () => {
      vigDirection = 'decrypt';
      vigModeDecrypt.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      vigModeEncrypt.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all text-slate-400 hover:text-white";
      runVigenereConversion();
    });

    vigInput.addEventListener('input', runVigenereConversion);
    vigKey.addEventListener('input', runVigenereConversion);

    function runVigenereConversion() {
      const text = vigInput.value;
      const key = vigKey.value;
      vigOutput.value = runVigenere(text, key, vigDirection);
    }

    a1DirectionEncode.addEventListener('click', () => {
      a1Direction = 'encode';
      a1DirectionEncode.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all bg-cyberMagenta/10 text-cyberMagenta font-bold";
      a1DirectionDecode.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all text-slate-400 hover:text-white";
      runA1Z26Conversion();
    });

    a1DirectionDecode.addEventListener('click', () => {
      a1Direction = 'decode';
      a1DirectionDecode.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all bg-cyberMagenta/10 text-cyberMagenta font-bold";
      a1DirectionEncode.className = "px-3 py-1 font-mono text-[10px] uppercase transition-all text-slate-400 hover:text-white";
      runA1Z26Conversion();
    });

    a1Input.addEventListener('input', runA1Z26Conversion);
    a1Separator.addEventListener('change', runA1Z26Conversion);

    function runA1Z26Conversion() {
      const text = a1Input.value;
      const sep = a1Separator.value;
      if (a1Direction === 'encode') {
        a1Output.value = encodeA1Z26(text, sep);
      } else {
        a1Output.value = decodeA1Z26(text, sep);
      }
    }

    // ==========================================
    // MORSE CODE TAB MODULE
    // ==========================================
    const morseInput = document.getElementById('morse-input');
    const morseOutput = document.getElementById('morse-output');
    const morseDirEncode = document.getElementById('morse-direction-encode');
    const morseDirDecode = document.getElementById('morse-direction-decode');
    let morseDirection = 'encode';

    morseDirEncode.addEventListener('click', () => {
      morseDirection = 'encode';
      morseDirEncode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      morseDirDecode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      runMorseConversion();
    });

    morseDirDecode.addEventListener('click', () => {
      morseDirection = 'decode';
      morseDirDecode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      morseDirEncode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      runMorseConversion();
    });

    morseInput.addEventListener('input', runMorseConversion);

    function runMorseConversion() {
      const text = morseInput.value;
      if (morseDirection === 'encode') {
        morseOutput.value = encodeMorse(text);
      } else {
        morseOutput.value = decodeMorse(text);
      }

      const displayEl = document.getElementById('morse-output-display');
      if (displayEl && !isPlayingMorse) {
        displayEl.textContent = morseOutput.value || "Morse characters will highlight during active audio playback.";
      }
    }

    const morsePlayBtn = document.getElementById('morse-play-btn');
    morsePlayBtn.addEventListener('click', playMorseAudio);

    let morseAudioCtx = null;
    let morseTimeoutIds = [];

    function stopMorseAudio() {
      morseTimeoutIds.forEach(id => clearTimeout(id));
      morseTimeoutIds = [];
      isPlayingMorse = false;

      morsePlayBtn.innerHTML = `
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        PLAY AUDIO
      `;
      morsePlayBtn.classList.remove('bg-amber-500/20', 'text-amber-400', 'border-amber-500');
      morsePlayBtn.classList.add('bg-cyberCyan/10', 'text-cyberCyan', 'border-cyberCyan/20');
      
      const displayEl = document.getElementById('morse-output-display');
      if (displayEl) {
        displayEl.innerHTML = escapeHTML(morseOutput.value) || "Morse characters will highlight during active audio playback.";
      }
    }

    function playMorseAudio() {
      if (isPlayingMorse) {
        stopMorseAudio();
        return;
      }

      const morseStr = morseOutput.value.trim();
      if (!morseStr) return;

      isPlayingMorse = true;
      morsePlayBtn.innerHTML = `
        <svg class="w-4 h-4 mr-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"></path></svg>
        STOP PLAYBACK
      `;
      morsePlayBtn.classList.remove('bg-cyberCyan/10', 'text-cyberCyan', 'border-cyberCyan/20');
      morsePlayBtn.classList.add('bg-amber-500/20', 'text-amber-400', 'border-amber-500');

      if (!morseAudioCtx) {
        morseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }

      const volumeVal = parseFloat(document.getElementById('morse-volume').value);

      const dotTime = 0.08; 
      const dashTime = dotTime * 3;
      const symbolGap = dotTime;
      const letterGap = dotTime * 3;
      const wordGap = dotTime * 7;

      let timeOffset = 0;
      
      const outputDisplay = document.getElementById('morse-output-display');
      outputDisplay.innerHTML = '';
      
      const chars = morseStr.split('');
      chars.forEach((char, idx) => {
        const span = document.createElement('span');
        span.textContent = char;
        span.id = `morse-char-${idx}`;
        span.className = "transition-all";
        outputDisplay.appendChild(span);
      });

      function playTone(duration, time) {
        if (morseAudioCtx.state === 'suspended') {
          morseAudioCtx.resume();
        }
        const osc = morseAudioCtx.createOscillator();
        const gainNode = morseAudioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, time);
        
        gainNode.gain.setValueAtTime(0, time);
        gainNode.gain.linearRampToValueAtTime(volumeVal, time + 0.005);
        gainNode.gain.setValueAtTime(volumeVal, time + duration - 0.005);
        gainNode.gain.linearRampToValueAtTime(0, time + duration);
        
        osc.connect(gainNode);
        gainNode.connect(morseAudioCtx.destination);
        
        osc.start(time);
        osc.stop(time + duration);
      }

      let startTime = morseAudioCtx.currentTime + 0.1;

      chars.forEach((char, idx) => {
        let delay = timeOffset * 1000;
        
        let tidHighlight = setTimeout(() => {
          for (let i = 0; i < chars.length; i++) {
            const el = document.getElementById(`morse-char-${i}`);
            if (el) {
              el.className = "text-slate-500 transition-all";
            }
          }
          const el = document.getElementById(`morse-char-${idx}`);
          if (el) {
            el.className = "text-cyberCyan font-bold scale-125 inline-block text-shadow";
          }
        }, delay);
        morseTimeoutIds.push(tidHighlight);

        if (char === '.') {
          playTone(dotTime, startTime + timeOffset);
          timeOffset += dotTime + symbolGap;
        } else if (char === '-') {
          playTone(dashTime, startTime + timeOffset);
          timeOffset += dashTime + symbolGap;
        } else if (char === ' ') {
          timeOffset += letterGap - symbolGap;
        } else if (char === '/') {
          timeOffset += wordGap - symbolGap;
        }
      });

      let endTid = setTimeout(() => {
        stopMorseAudio();
      }, timeOffset * 1000 + 100);
      morseTimeoutIds.push(endTid);
    }

    // ==========================================
    // AUDIO MORSE DECODER MODULE
    // ==========================================
    const morseListenBtn = document.getElementById('morse-decode-listen-btn');
    const morseListenDot = document.getElementById('morse-decode-listen-dot');
    const morseListenText = document.getElementById('morse-decode-listen-text');
    const morseClearBtn = document.getElementById('morse-decode-clear-btn');
    const morseThresholdSlider = document.getElementById('morse-decoder-threshold');
    const morseThresholdVal = document.getElementById('morse-decoder-threshold-val');
    const morseCharWpmSlider = document.getElementById('morse-decoder-char-wpm');
    const morseCharWpmVal = document.getElementById('morse-decoder-char-wpm-val');
    const morseSpaceWpmSlider = document.getElementById('morse-decoder-space-wpm');
    const morseSpaceWpmVal = document.getElementById('morse-decoder-space-wpm-val');
    const morseDropzone = document.getElementById('morse-dropzone');
    const morseFileInput = document.getElementById('morse-audio-file-input');
    const morseLoadedFilename = document.getElementById('morse-loaded-filename');

    morseThresholdSlider.addEventListener('input', (e) => {
      morseThresholdVal.textContent = parseFloat(e.target.value).toFixed(2);
    });

    morseCharWpmSlider.addEventListener('input', (e) => {
      morseCharWpmVal.textContent = e.target.value;
    });

    morseSpaceWpmSlider.addEventListener('input', (e) => {
      morseSpaceWpmVal.textContent = e.target.value;
    });

    morseFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleAudioFile(file);
        startMorseDecoderAutomatically();
      }
    });

    setupStegoDropzone(morseDropzone, morseFileInput, (file) => {
      handleAudioFile(file);
      startMorseDecoderAutomatically();
    });

    function startMorseDecoderAutomatically() {
      if (!isMorseDecoding) {
        morseListenBtn.click();
      }
    }

    morseClearBtn.addEventListener('click', () => {
      const streamTextarea = document.getElementById('morse-decode-stream');
      if (streamTextarea) streamTextarea.value = '';
      window.api.processMorseFrame({ reset: true, now: performance.now() });
    });

    morseListenBtn.addEventListener('click', () => {
      if (isMorseDecoding) {
        // Stop listening
        isMorseDecoding = false;
        morseListenDot.className = "w-2 h-2 rounded-full bg-red-500";
        morseListenText.textContent = "Listen to Audio Source";
        morseListenBtn.className = "w-full py-3 border border-cyberCyan text-cyberCyan font-mono text-xs uppercase tracking-wider rounded bg-cyberCyan/10 hover:bg-cyberCyan/20 transition-all flex items-center justify-center gap-2";
        
        const led = document.getElementById('morse-decoder-led');
        if (led) led.className = "w-2.5 h-2.5 rounded-full bg-slate-700";

        // Stop render loop if not viewing visualizer tab and not decoding
        if (state.activeTab !== 'visualizer' && visualizerAnimationId) {
          cancelAnimationFrame(visualizerAnimationId);
          visualizerAnimationId = null;
        }
      } else {
        // Start listening
        initAudioPipeline(); // Make sure AudioContext/analyser is created
        isMorseDecoding = true;
        morseListenDot.className = "w-2 h-2 rounded-full bg-cyberGreen shadow-[0_0_8px_#39ff14] animate-ping";
        morseListenText.textContent = "STOP DECODER FEED";
        morseListenBtn.className = "w-full py-3 border border-cyberGreen text-cyberGreen font-mono text-xs uppercase tracking-wider rounded bg-cyberGreen/10 hover:bg-cyberGreen/20 transition-all flex items-center justify-center gap-2";
        
        // Reset Morse backend decoder session
        window.api.processMorseFrame({ reset: true, now: performance.now() });
        
        const streamTextarea = document.getElementById('morse-decode-stream');
        if (streamTextarea && !isMicActive && !isAudioPlaying) {
          streamTextarea.value = "[DECODER ACTIVE: Toggle Live Mic or play an audio file to begin decoding...]\n";
          streamTextarea.scrollTop = streamTextarea.scrollHeight;
        }

        // Start render loop if not running
        if (!visualizerAnimationId && (isMicActive || isAudioPlaying) && visualizerAnalyser) {
          renderLoop();
        }
      }
    });

    function getMorseTargetAmplitude() {
      if (!visualizerAnalyser) return 0;
      
      const bufferLength = visualizerAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      visualizerAnalyser.getByteFrequencyData(dataArray);
      
      const sampleRate = visualizerAudioCtx ? visualizerAudioCtx.sampleRate : 44100;
      const binSize = sampleRate / (bufferLength * 2);
      
      // Target pitch standard Morse (~700Hz to ~900Hz)
      const startBin = Math.floor(700 / binSize);
      const endBin = Math.ceil(900 / binSize);
      
      let maxVal = 0;
      for (let i = startBin; i <= endBin; i++) {
        if (dataArray[i] > maxVal) {
          maxVal = dataArray[i];
        }
      }
      
      return maxVal / 255;
    }

    async function processMorseAudioFrame() {
      const amp = getMorseTargetAmplitude();
      const threshold = parseFloat(morseThresholdSlider.value);
      const charWpm = parseInt(morseCharWpmSlider.value);
      const spaceWpm = parseInt(morseSpaceWpmSlider.value);
      const now = performance.now();

      try {
        const result = await window.api.processMorseFrame({
          amp,
          threshold,
          charWpm,
          spaceWpm,
          now
        });

        // Update LED indicator
        const led = document.getElementById('morse-decoder-led');
        if (led) {
          if (result.ledOn) {
            led.className = "w-2.5 h-2.5 rounded-full bg-cyberGreen shadow-[0_0_8px_#39ff14]";
          } else {
            led.className = "w-2.5 h-2.5 rounded-full bg-slate-700";
          }
        }

        // Update stream output textarea
        const streamTextarea = document.getElementById('morse-decode-stream');
        if (streamTextarea && result.text !== undefined) {
          const originalVal = streamTextarea.value;
          if (result.text && !originalVal.includes(result.text)) {
            streamTextarea.value = result.text;
            streamTextarea.scrollTop = streamTextarea.scrollHeight;
          } else if (!result.text && originalVal && !originalVal.includes("[DECODER ACTIVE:")) {
            streamTextarea.value = result.text;
          }
        }
      } catch (err) {
        console.error("Morse frame processing failed:", err);
      }
    }

    // ==========================================
    // HEX CODER TAB MODULE
    // ==========================================
    // ==========================================
    const hexInput = document.getElementById('hex-input');
    const hexOutput = document.getElementById('hex-output');
    const hexDirEncode = document.getElementById('hex-direction-encode');
    const hexDirDecode = document.getElementById('hex-direction-decode');
    const hexSeparator = document.getElementById('hex-separator');
    const hexOptions = document.getElementById('hex-encoding-options');
    let hexDirection = 'encode';

    hexDirEncode.addEventListener('click', () => {
      hexDirection = 'encode';
      hexDirEncode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      hexDirDecode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      hexOptions.classList.remove('hidden');
      runHexConversion();
    });

    hexDirDecode.addEventListener('click', () => {
      hexDirection = 'decode';
      hexDirDecode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      hexDirEncode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      hexOptions.classList.add('hidden');
      runHexConversion();
    });

    hexInput.addEventListener('input', runHexConversion);
    hexSeparator.addEventListener('change', runHexConversion);

    function runHexConversion() {
      const text = hexInput.value;
      const sep = hexSeparator.value;
      
      if (hexDirection === 'encode') {
        hexOutput.value = encodeHex(text, sep);
      } else {
        hexOutput.value = decodeHex(text);
      }
    }

    // ==========================================
    // BINARY CODER TAB MODULE
    // ==========================================
    const binaryInput = document.getElementById('binary-input');
    const binaryOutput = document.getElementById('binary-output');
    const binaryDirEncode = document.getElementById('binary-direction-encode');
    const binaryDirDecode = document.getElementById('binary-direction-decode');
    const binarySeparator = document.getElementById('binary-separator');
    const binaryOptions = document.getElementById('bin-encoding-options');
    let binaryDirection = 'encode';

    binaryDirEncode.addEventListener('click', () => {
      binaryDirection = 'encode';
      binaryDirEncode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      binaryDirDecode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      binaryOptions.classList.remove('hidden');
      runBinaryConversion();
    });

    binaryDirDecode.addEventListener('click', () => {
      binaryDirection = 'decode';
      binaryDirDecode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all bg-cyberCyan/10 text-cyberCyan font-bold";
      binaryDirEncode.className = "px-3 py-1.5 font-mono text-xs uppercase transition-all text-slate-400 hover:text-white";
      binaryOptions.classList.add('hidden');
      runBinaryConversion();
    });

    binaryInput.addEventListener('input', runBinaryConversion);
    binarySeparator.addEventListener('change', runBinaryConversion);

    function runBinaryConversion() {
      const text = binaryInput.value;
      const isSpaced = binarySeparator.value === 'space';

      if (binaryDirection === 'encode') {
        binaryOutput.value = encodeBinary(text, isSpaced);
      } else {
        binaryOutput.value = decodeBinary(text);
      }
    }

    // ==========================================
    // AUDIO VISUALIZER MODULE
    // ==========================================
    const fileInput = document.getElementById('audio-file-input');
    const dropzone = document.getElementById('visualizer-dropzone');
    const loadedFilename = document.getElementById('loaded-filename');
    canvas = document.getElementById('visualizer-canvas');
    ctx = canvas.getContext('2d');
    
    const btnModeBars = document.getElementById('viz-mode-bars');
    const btnModeRadial = document.getElementById('viz-mode-radial');
    const btnModeWave = document.getElementById('viz-mode-wave');

    const btnPlay = document.getElementById('audio-play-btn');
    const playSvg = document.getElementById('play-svg');
    const pauseSvg = document.getElementById('pause-svg');
    const progressTimeline = document.getElementById('audio-progress');
    const volumeSlider = document.getElementById('audio-volume');
    const activeText = document.getElementById('visualizer-active-text');
    const activeIndicator = document.getElementById('visualizer-active-indicator');

    // Spectrogram UI Controls
    const speedSlider = document.getElementById('spectrogram-scroll-speed');
    const speedVal = document.getElementById('spectrogram-scroll-speed-val');
    const zoomRangeSelect = document.getElementById('spectrogram-zoom-range');
    const gainSlider = document.getElementById('spectrogram-gain');
    const gainVal = document.getElementById('spectrogram-gain-val');

    speedSlider.addEventListener('input', (e) => {
      spectrogramScrollSpeed = parseInt(e.target.value, 10);
      speedVal.textContent = `${spectrogramScrollSpeed}px`;
    });

    zoomRangeSelect.addEventListener('change', (e) => {
      spectrogramRangeMode = e.target.value;
      updateFrequencyAxis();
    });

    gainSlider.addEventListener('input', (e) => {
      spectrogramGain = parseFloat(e.target.value);
      gainVal.textContent = `${spectrogramGain.toFixed(1)}x`;
    });

    resizeCanvas();
    updateFrequencyAxis();

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      
      // Save current canvas contents before resize
      let tempCanvas = null;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(canvas, 0, 0);
      }

      // Resize canvas to physical dimensions
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      // Redraw old content to fit new bounds (before applying context scaling)
      if (tempCanvas) {
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
      }

      // Re-apply DPR scaling for logical canvas operations
      ctx.scale(dpr, dpr);
    }
    window.addEventListener('resize', resizeCanvas);

    btnModeBars.addEventListener('click', () => setVisualizerMode('bars'));
    btnModeRadial.addEventListener('click', () => setVisualizerMode('radial'));
    btnModeWave.addEventListener('click', () => setVisualizerMode('wave'));

    function setVisualizerMode(mode) {
      currentVisualizerMode = mode;
      
      btnModeBars.className = "px-3 py-1 text-slate-400 hover:text-white rounded font-mono text-xs";
      btnModeRadial.className = "px-3 py-1 text-slate-400 hover:text-white rounded font-mono text-xs";
      btnModeWave.className = "px-3 py-1 text-slate-400 hover:text-white rounded font-mono text-xs";

      if (mode === 'bars') {
        btnModeBars.className = "px-3 py-1 bg-cyberCyan/10 text-cyberCyan border border-cyberCyan/20 rounded font-mono text-xs";
      } else if (mode === 'radial') {
        btnModeRadial.className = "px-3 py-1 bg-cyberMagenta/10 text-cyberMagenta border border-cyberMagenta/20 rounded font-mono text-xs";
      } else if (mode === 'wave') {
        btnModeWave.className = "px-3 py-1 bg-cyberGreen/10 text-cyberGreen border border-cyberGreen/20 rounded font-mono text-xs";
      }
    }

    // Global Audio Pipeline Initializer (Guarantees single instance creation)
    function initAudioPipeline() {
      if (!visualizerAudioCtx) {
        visualizerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        updateFrequencyAxis();
      }
      if (!visualizerAnalyser) {
        visualizerAnalyser = visualizerAudioCtx.createAnalyser();
        visualizerAnalyser.fftSize = 4096;
        visualizerAnalyser.smoothingTimeConstant = 0;
      }
      if (!visualizerSource) {
        visualizerSource = visualizerAudioCtx.createMediaElementSource(audioPlayer);
        // Connect source to analyser for visual mapping
        visualizerSource.connect(visualizerAnalyser);
        // Connect source to speakers for output audio
        visualizerSource.connect(visualizerAudioCtx.destination);
      }
      if (visualizerAudioCtx.state === 'suspended') {
        visualizerAudioCtx.resume();
      }
    }

    // Drag-and-drop Event Listeners (Fully stops propagation and defaults)
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    // Add visual glow on hover states
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, () => {
        dropzone.classList.remove('border-cyberBorder');
        dropzone.classList.add('border-cyberCyan', 'shadow-cyan-glow');
      }, false);
    });

    // Revert visual states on leave or drop
    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, () => {
        dropzone.classList.add('border-cyberBorder');
        dropzone.classList.remove('border-cyberCyan', 'shadow-cyan-glow');
      }, false);
    });

    // Handle Dropped Files safely
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('audio/')) {
        handleAudioFile(file);
      }
    });

    // Handle Input File changes
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleAudioFile(file);
      }
    });

    // Unified Audio Processing Pipeline
    function handleAudioFile(file) {
      if (!file || !file.type.startsWith('audio/')) {
        alert("Please load a valid audio file (.mp3, .wav).");
        return;
      }

      if (isMicActive) stopMic();

      // Lazy-initialize audio pipeline inside this user action context
      initAudioPipeline();

      loadedFilename.textContent = file.name;
      loadedFilename.classList.remove('hidden');

      if (morseLoadedFilename) {
        morseLoadedFilename.textContent = file.name;
        morseLoadedFilename.classList.remove('hidden');
      }
      
      // Revoke the old object URL to prevent memory leaks
      if (audioPlayer.src && audioPlayer.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioPlayer.src);
      }

      const fileURL = URL.createObjectURL(file);
      audioPlayer.src = fileURL;
      audioPlayer.load();
      
      progressTimeline.value = 0;
      document.getElementById('audio-time').textContent = '0:00 / 0:00';
      
      audioPlayer.play().catch(err => {
        console.error("Audio play failed or was interrupted:", err);
      });
    }

    setupAudioPlayer();

    function setupAudioPlayer() {
      btnPlay.addEventListener('click', () => {
        if (isMicActive) stopMic();

        if (!audioPlayer.src) {
          fileInput.click();
          return;
        }

        if (isAudioPlaying) {
          audioPlayer.pause();
        } else {
          audioPlayer.play();
        }
      });

      audioPlayer.addEventListener('play', () => {
        isAudioPlaying = true;
        updatePlayPauseUI();
        
        initAudioPipeline();

        activeIndicator.className = "w-2 h-2 bg-cyberCyan rounded-full shadow-[0_0_8px_#00f0ff] animate-ping";
        activeText.textContent = "PLAYING";
        activeText.className = "text-[10px] uppercase font-mono text-cyberCyan";

        renderLoop();
      });

      audioPlayer.addEventListener('pause', () => {
        isAudioPlaying = false;
        updatePlayPauseUI();
        
        activeIndicator.className = "w-2 h-2 bg-slate-700 rounded-full";
        activeText.textContent = "PAUSED";
        activeText.className = "text-[10px] uppercase font-mono text-slate-500";
      });

      audioPlayer.addEventListener('timeupdate', () => {
        if (audioPlayer.duration) {
          const curMin = Math.floor(audioPlayer.currentTime / 60);
          const curSec = Math.floor(audioPlayer.currentTime % 60).toString().padStart(2, '0');
          const durMin = Math.floor(audioPlayer.duration / 60);
          const durSec = Math.floor(audioPlayer.duration % 60).toString().padStart(2, '0');
          
          document.getElementById('audio-time').textContent = `${curMin}:${curSec} / ${durMin}:${durSec}`;
          progressTimeline.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        }
      });

      progressTimeline.addEventListener('input', () => {
        if (audioPlayer.duration) {
          audioPlayer.currentTime = (progressTimeline.value / 100) * audioPlayer.duration;
        }
      });

      volumeSlider.addEventListener('input', () => {
        audioPlayer.volume = volumeSlider.value;
      });

      audioPlayer.addEventListener('ended', () => {
        isAudioPlaying = false;
        updatePlayPauseUI();
        progressTimeline.value = 0;
        document.getElementById('audio-time').textContent = '0:00 / 0:00';

        // Force Flush Morse signal stream if ending playback
        if (isMorseDecoding) {
          window.api.processMorseFrame({ flush: true }).then(result => {
            const streamTextarea = document.getElementById('morse-decode-stream');
            if (streamTextarea && result.text) {
              streamTextarea.value = result.text;
            }
          });
        }
      });
    }

    function updatePlayPauseUI() {
      if (isAudioPlaying) {
        playSvg.classList.add('hidden');
        pauseSvg.classList.remove('hidden');
      } else {
        playSvg.classList.remove('hidden');
        pauseSvg.classList.add('hidden');
      }
    }

    const micToggleBtn = document.getElementById('mic-toggle-btn');
    micToggleBtn.addEventListener('click', toggleMic);

    async function toggleMic() {
      if (isMicActive) {
        stopMic();
        return;
      }

      if (isAudioPlaying) {
        audioPlayer.pause();
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        visualizerMicStream = stream;
        isMicActive = true;

        if (!visualizerAudioCtx) {
          visualizerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
          updateFrequencyAxis();
        }
        if (!visualizerAnalyser) {
          visualizerAnalyser = visualizerAudioCtx.createAnalyser();
          visualizerAnalyser.fftSize = 4096;
          visualizerAnalyser.smoothingTimeConstant = 0;
        }

        if (visualizerAudioCtx.state === 'suspended') {
          await visualizerAudioCtx.resume();
        }

        // Connect mic stream source ONLY to the analyser (prevents speaker feedback loops!)
        visualizerMicSource = visualizerAudioCtx.createMediaStreamSource(stream);
        visualizerMicSource.connect(visualizerAnalyser);

        document.getElementById('mic-btn-status').textContent = 'LIVE FEED';
        document.getElementById('mic-btn-dot').className = "w-2.5 h-2.5 rounded-full bg-cyberGreen shadow-[0_0_8px_#39ff14] animate-ping";
        micToggleBtn.classList.remove('border-red-500/20', 'bg-red-500/5', 'text-red-500');
        micToggleBtn.classList.add('border-cyberGreen', 'bg-cyberGreen/10', 'text-cyberGreen');
        
        document.getElementById('player-controls-panel').classList.add('opacity-30', 'pointer-events-none');
        activeIndicator.className = "w-2 h-2 bg-cyberGreen rounded-full shadow-[0_0_8px_#39ff14] animate-ping";
        activeText.textContent = "MIC INPUT";
        activeText.className = "text-[10px] uppercase font-mono text-cyberGreen";

        renderLoop();
      } catch (err) {
        console.error("Mic error:", err);
        alert("Microphone permission denied or source unavailable.");
      }
    }

    function stopMic() {
      if (!isMicActive) return;
      isMicActive = false;

      if (visualizerMicStream) {
        visualizerMicStream.getTracks().forEach(track => track.stop());
        visualizerMicStream = null;
      }

      if (visualizerMicSource) {
        visualizerMicSource.disconnect();
        visualizerMicSource = null;
      }

      document.getElementById('mic-btn-status').textContent = 'MIC IN';
      document.getElementById('mic-btn-dot').className = "w-2.5 h-2.5 rounded-full bg-red-500";
      micToggleBtn.classList.remove('border-cyberGreen', 'bg-cyberGreen/10', 'text-cyberGreen');
      micToggleBtn.classList.add('border-red-500/20', 'bg-red-500/5', 'text-red-500');

      document.getElementById('player-controls-panel').classList.remove('opacity-30', 'pointer-events-none');
      activeIndicator.className = "w-2 h-2 bg-slate-700 rounded-full";
      activeText.textContent = "STANDBY";
      activeText.className = "text-[10px] uppercase font-mono text-slate-500";

      if (visualizerAnimationId) {
        cancelAnimationFrame(visualizerAnimationId);
        visualizerAnimationId = null;
      }
    }

    function renderLoop() {
      if (!visualizerAnalyser) return;

      if (isAudioPlaying || isMicActive) {
        // 1. Spectrogram Rendering (only if visualizer tab is active)
        if (state.activeTab === 'visualizer') {
          const rect = canvas.getBoundingClientRect();
          const width = rect.width;
          const height = rect.height;
          const dpr = window.devicePixelRatio || 1;

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const shiftPhysical = spectrogramScrollSpeed * dpr;
          ctx.drawImage(canvas, -shiftPhysical, 0);
          ctx.scale(dpr, dpr);

          const bufferLength = visualizerAnalyser.frequencyBinCount;
          let dataArray = new Uint8Array(bufferLength);
          visualizerAnalyser.getByteFrequencyData(dataArray);

          const sampleRate = visualizerAudioCtx.sampleRate;
          const { minFreq, maxFreq } = getFreqRange(sampleRate, spectrogramRangeMode);
          const nyquist = sampleRate / 2;

          const minBin = Math.floor((minFreq / nyquist) * bufferLength);
          const maxBin = Math.min(bufferLength - 1, Math.ceil((maxFreq / nyquist) * bufferLength));
          const binCount = maxBin - minBin + 1;

          const x = width - spectrogramScrollSpeed;
          const colWidth = spectrogramScrollSpeed;
          const stepHeight = height / binCount;

          for (let index = 0; index < binCount; index++) {
            const y = height - (index * (height / binCount));
            let val = dataArray[minBin + index] * spectrogramGain;
            if (val > 255) val = 255;
            ctx.fillStyle = getColorForIntensity(Math.round(val));
            ctx.fillRect(x, y - stepHeight, colWidth, stepHeight + 0.5);
          }
        }

        // 2. Audio Morse Decoder Processing
        if (isMorseDecoding) {
          processMorseAudioFrame();
        }
      }

      visualizerAnimationId = requestAnimationFrame(renderLoop);
    }

    // Cyberpunk color mapping based on intensity (0 - 255)
    // Enhanced contrast for low values to prevent losing faint image details
    function getColorForIntensity(val) {
      if (val === 0) {
        // Pure silence: Deep dark background
        return '#060913';
      } else if (val <= 50) {
        // 1 to 50: Low-intensity faint detail (mapped to visible dark indigo-purple)
        const ratio = val / 50;
        const r = Math.round(20 + ratio * 40);   // 20 to 60
        const g = Math.round(5 + ratio * 5);     // 5 to 10
        const b = Math.round(50 + ratio * 80);   // 50 to 130
        return `rgb(${r}, ${g}, ${b})`;
      } else if (val <= 150) {
        // 51 to 150: Vibrant neon purple / deep indigo
        const ratio = (val - 51) / 99;
        const r = Math.round(60 + ratio * 63);   // 60 to 123
        const g = Math.round(10 + ratio * 34);   // 10 to 44
        const b = Math.round(130 + ratio * 61);  // 130 to 191
        return `rgb(${r}, ${g}, ${b})`;
      } else if (val <= 230) {
        // 151 to 230: Electric cyan to neon green transition
        const ratio = (val - 151) / 79;
        const r = Math.round(0 + ratio * 57);    // 0 to 57
        const g = Math.round(240 + ratio * 15);  // 240 to 255
        const b = Math.round(255 - ratio * 235); // 255 to 20
        return `rgb(${r}, ${g}, ${b})`;
      } else {
        // 231 to 255: Hot pink, bright magenta, or pure white peaks
        const ratio = (val - 231) / 24;
        const r = 255;
        const g = Math.round(ratio * 255);
        const b = Math.round(127 + ratio * 128); // 127 to 255
        return `rgb(${r}, ${g}, ${b})`;
      }
    }

    // Helper functions for Spectrogram vertical zoom and right-side frequency axis
    function getFreqRange(sampleRate, rangeMode) {
      const nyquist = sampleRate / 2;
      let minFreq = 0;
      let maxFreq = nyquist;

      if (rangeMode === 'art18') {
        maxFreq = Math.min(18000, nyquist);
      } else if (rangeMode === 'art15') {
        maxFreq = Math.min(15000, nyquist);
      } else if (rangeMode === 'mid8') {
        maxFreq = Math.min(8000, nyquist);
      } else if (rangeMode === 'mid4') {
        maxFreq = Math.min(4000, nyquist);
      } else if (rangeMode === 'bass2') {
        maxFreq = Math.min(2000, nyquist);
      }

      return { minFreq, maxFreq };
    }

    function updateFrequencyAxis() {
      const axis = document.getElementById('visualizer-axis');
      if (!axis) return;
      axis.innerHTML = '';

      const sampleRate = (visualizerAudioCtx && visualizerAudioCtx.sampleRate) || 44100;
      const { minFreq, maxFreq } = getFreqRange(sampleRate, spectrogramRangeMode);

      const numTicks = 6;
      for (let i = 0; i < numTicks; i++) {
        const ratio = i / (numTicks - 1); // 0 at bottom, 1 at top
        const freq = minFreq + ratio * (maxFreq - minFreq);
        const pct = (1 - ratio) * 100; // 0% at top, 100% at bottom

        let label = '';
        if (freq >= 1000) {
          label = `${(freq / 1000).toFixed(1)} kHz`;
        } else {
          label = `${Math.round(freq)} Hz`;
        }

        const tickWrapper = document.createElement('div');
        tickWrapper.className = 'absolute left-0 right-0 flex items-center justify-between pointer-events-none px-1 h-4';
        tickWrapper.style.top = `${pct}%`;
        tickWrapper.style.transform = 'translateY(-50%)';

        const tickLine = document.createElement('div');
        tickLine.className = 'w-1.5 h-[1px] bg-cyberCyan/40';

        const tickLabel = document.createElement('span');
        tickLabel.className = 'text-[9px] font-mono text-cyberCyan/90 pr-1 text-right select-none';
        tickLabel.textContent = label;

        tickWrapper.appendChild(tickLine);
        tickWrapper.appendChild(tickLabel);

        axis.appendChild(tickWrapper);
      }
    }

    // ==========================================
    // XOR CIPHER MODULE
    // ==========================================
    const xorModeText = document.getElementById('xor-mode-text');
    const xorModeHex = document.getElementById('xor-mode-hex');
    const xorInput = document.getElementById('xor-input');
    const xorKey = document.getElementById('xor-key');
    const xorOutputHex = document.getElementById('xor-output-hex');
    const xorOutputText = document.getElementById('xor-output-text');
    const xorError = document.getElementById('xor-error-banner');

    xorModeText.addEventListener('click', () => {
      xorKeyMode = 'text';
      xorModeText.className = "px-3 py-1 font-mono text-xs uppercase rounded transition-all bg-cyberCyan/10 text-cyberCyan border border-cyberCyan/20";
      xorModeHex.className = "px-3 py-1 font-mono text-xs uppercase rounded transition-all text-slate-400 hover:text-white";
      runXORCipher();
    });

    xorModeHex.addEventListener('click', () => {
      xorKeyMode = 'hex';
      xorModeHex.className = "px-3 py-1 font-mono text-xs uppercase rounded transition-all bg-cyberCyan/10 text-cyberCyan border border-cyberCyan/20";
      xorModeText.className = "px-3 py-1 font-mono text-xs uppercase rounded transition-all text-slate-400 hover:text-white";
      runXORCipher();
    });

    xorInput.addEventListener('input', runXORCipher);
    xorKey.addEventListener('input', runXORCipher);

    function runXORCipher() {
      const input = xorInput.value;
      const key = xorKey.value;
      
      xorError.classList.add('hidden');
      
      if (!input || !key) {
        xorOutputHex.value = '';
        xorOutputText.value = '';
        return;
      }
      
      try {
        if (xorKeyMode === 'hex') {
          const cleanInput = input.replace(/[\s:-]/g, '').replace(/^0x/gi, '');
          const cleanKey = key.replace(/[\s:-]/g, '').replace(/^0x/gi, '');
          
          const hexRegex = /^[0-9a-fA-F]*$/;
          if (!hexRegex.test(cleanInput) || cleanInput.length % 2 !== 0) {
            throw new Error("Input must be valid hexadecimal pairs.");
          }
          if (!hexRegex.test(cleanKey) || cleanKey.length % 2 !== 0) {
            throw new Error("Key must be valid hexadecimal pairs.");
          }
          
          const inputBytes = [];
          for (let i = 0; i < cleanInput.length; i += 2) {
            inputBytes.push(parseInt(cleanInput.substring(i, 2), 16));
          }
          
          const keyBytes = [];
          for (let i = 0; i < cleanKey.length; i += 2) {
            keyBytes.push(parseInt(cleanKey.substring(i, 2), 16));
          }
          
          const resultBytes = [];
          for (let i = 0; i < inputBytes.length; i++) {
            resultBytes.push(inputBytes[i] ^ keyBytes[i % keyBytes.length]);
          }
          
          const resHex = resultBytes.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
          xorOutputHex.value = resHex;
          
          try {
            const dec = new TextDecoder("utf-8", { fatal: true });
            xorOutputText.value = dec.decode(new Uint8Array(resultBytes));
          } catch (_) {
            xorOutputText.value = "[Non-printable binary content]";
          }
        } else {
          const encoder = new TextEncoder();
          const inputBytes = encoder.encode(input);
          const keyBytes = encoder.encode(key);
          
          const resultBytes = [];
          for (let i = 0; i < inputBytes.length; i++) {
            resultBytes.push(inputBytes[i] ^ keyBytes[i % keyBytes.length]);
          }
          
          const resHex = resultBytes.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
          xorOutputHex.value = resHex;
          
          try {
            const dec = new TextDecoder("utf-8", { fatal: true });
            xorOutputText.value = dec.decode(new Uint8Array(resultBytes));
          } catch (_) {
            xorOutputText.value = resultBytes.map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '').join('');
          }
        }
      } catch (err) {
        xorError.textContent = err.message;
        xorError.classList.remove('hidden');
        xorOutputHex.value = '';
        xorOutputText.value = '';
      }
    }

    // ==========================================
    // JWT DECODER MODULE
    // ==========================================
    const jwtInput = document.getElementById('jwt-input');
    const jwtVisualizer = document.getElementById('jwt-visualizer');
    const jwtHeader = document.getElementById('jwt-header');
    const jwtPayload = document.getElementById('jwt-payload');
    const jwtError = document.getElementById('jwt-error-banner');

    jwtInput.addEventListener('input', () => {
      const token = jwtInput.value.trim();
      jwtError.classList.add('hidden');
      jwtVisualizer.innerHTML = '';
      jwtHeader.value = '';
      jwtPayload.value = '';

      if (!token) {
        jwtVisualizer.textContent = 'PASTE TOKEN TO VIEW SEGMENTS';
        return;
      }

      const parts = token.split('.');
      if (parts.length !== 3) {
        jwtError.textContent = 'INVALID JWT: Token must consist of exactly 3 parts separated by dots.';
        jwtError.classList.remove('hidden');
        jwtVisualizer.textContent = 'INVALID TOKEN';
        return;
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      jwtVisualizer.innerHTML = `
        <span class="text-cyberMagenta">${headerB64}</span>.<span class="text-cyberCyan">${payloadB64}</span>.<span class="text-cyberGreen">${signatureB64}</span>
      `;

      try {
        let headerJson = '';
        try {
          const decodedHeader = decodeBase64Url(headerB64);
          headerJson = JSON.stringify(JSON.parse(decodedHeader), null, 2);
          jwtHeader.value = headerJson;
        } catch (_) {
          throw new Error("Failed to decode token Header (invalid Base64Url or JSON).");
        }

        let payloadJson = '';
        try {
          const decodedPayload = decodeBase64Url(payloadB64);
          payloadJson = JSON.stringify(JSON.parse(decodedPayload), null, 2);
          jwtPayload.value = payloadJson;
        } catch (_) {
          throw new Error("Failed to decode token Payload (invalid Base64Url or JSON).");
        }
      } catch (err) {
        jwtError.textContent = `JWT DECODE ERROR: ${err.message}`;
        jwtError.classList.remove('hidden');
      }
    });

    function decodeBase64Url(str) {
      let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      return decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    }

    // ==========================================
    // FILE HASHER MODULE
    // ==========================================
    const hasherDropzone = document.getElementById('hasher-dropzone');
    const hasherFileInput = document.getElementById('hasher-file-input');
    const hasherFilename = document.getElementById('hasher-filename');
    const hasherFileInfo = document.getElementById('hasher-file-info');
    
    const hasherDetailName = document.getElementById('hasher-detail-name');
    const hasherDetailSize = document.getElementById('hasher-detail-size');
    const hasherDetailType = document.getElementById('hasher-detail-type');
    
    const hasherSha256 = document.getElementById('hasher-sha256');
    const hasherSha1 = document.getElementById('hasher-sha1');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      hasherDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      hasherDropzone.addEventListener(eventName, () => {
        hasherDropzone.classList.remove('border-cyberBorder');
        hasherDropzone.classList.add('border-cyberCyan', 'shadow-cyan-glow');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      hasherDropzone.addEventListener(eventName, () => {
        hasherDropzone.classList.add('border-cyberBorder');
        hasherDropzone.classList.remove('border-cyberCyan', 'shadow-cyan-glow');
      }, false);
    });

    hasherDropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleHasherFile(file);
    });

    hasherFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleHasherFile(file);
    });

    async function handleHasherFile(file) {
      hasherFilename.textContent = file.name;
      hasherFilename.classList.remove('hidden');

      hasherDetailName.textContent = file.name;
      hasherDetailSize.textContent = formatBytes(file.size);
      hasherDetailType.textContent = file.type || 'Unknown';
      hasherFileInfo.classList.remove('hidden');

      hasherSha256.value = "Calculating SHA-256...";
      hasherSha1.value = "Calculating SHA-1...";

      try {
        const result = await window.api.hashFile(file.path);
        if (result.success) {
          hasherSha256.value = result.sha256;
          hasherSha1.value = result.sha1;
        } else {
          throw new Error(result.error);
        }
      } catch (err) {
        console.error("Hashing failed:", err);
        hasherSha256.value = "Error: Hashing failed (" + err.message + ")";
        hasherSha1.value = "Error: Hashing failed (" + err.message + ")";
      }
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function bufferToHex(buffer) {
      const byteArray = new Uint8Array(buffer);
      return [...byteArray].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ==========================================
    // IMAGE STEGANOGRAPHY MODULE
    // ==========================================
    const stegoSubtabHide = document.getElementById('stego-subtab-hide');
    const stegoSubtabExtract = document.getElementById('stego-subtab-extract');
    const stegoPanelHide = document.getElementById('stego-panel-hide');
    const stegoPanelExtract = document.getElementById('stego-panel-extract');

    stegoSubtabHide.addEventListener('click', () => {
      stegoSubtabHide.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all bg-cyberCyan/10 text-cyberCyan border border-cyberCyan/20";
      stegoSubtabExtract.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all text-slate-400 hover:text-white";
      stegoPanelHide.classList.remove('hidden');
      stegoPanelExtract.classList.add('hidden');
    });

    stegoSubtabExtract.addEventListener('click', () => {
      stegoSubtabExtract.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all bg-cyberCyan/10 text-cyberCyan border border-cyberCyan/20";
      stegoSubtabHide.className = "px-4 py-1.5 font-mono text-xs uppercase rounded transition-all text-slate-400 hover:text-white";
      stegoPanelExtract.classList.remove('hidden');
      stegoPanelHide.classList.add('hidden');
    });

    const stegoHideInput = document.getElementById('stego-hide-input');
    const stegoHideDropzone = document.getElementById('stego-hide-dropzone');
    const stegoHideFilename = document.getElementById('stego-hide-filename');
    const stegoHidePreview = document.getElementById('stego-hide-preview');
    const stegoHidePreviewPlaceholder = document.getElementById('stego-hide-preview-placeholder');
    const stegoHideMessage = document.getElementById('stego-hide-message');
    const stegoHideError = document.getElementById('stego-hide-error');
    const stegoHideBtn = document.getElementById('stego-hide-btn');

    setupStegoDropzone(stegoHideDropzone, stegoHideInput, (file) => {
      stegoHideFilename.textContent = file.name;
      stegoHideFilename.classList.remove('hidden');
      stegoHideError.classList.add('hidden');

      const reader = new FileReader();
      reader.onload = (e) => {
        stegoHidePreview.src = e.target.result;
        stegoHidePreview.classList.remove('hidden');
        stegoHidePreviewPlaceholder.classList.add('hidden');

        stegoHideImage = new Image();
        stegoHideImage.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });

    stegoHideBtn.addEventListener('click', () => {
      stegoHideError.classList.add('hidden');
      if (!stegoHideImage) {
        showStegoError(stegoHideError, "Please upload a source image first.");
        return;
      }
      const message = stegoHideMessage.value;
      if (!message) {
        showStegoError(stegoHideError, "Please enter a message to hide.");
        return;
      }

      const canvasOff = document.createElement('canvas');
      canvasOff.width = stegoHideImage.width;
      canvasOff.height = stegoHideImage.height;
      const ctxOff = canvasOff.getContext('2d');
      ctxOff.drawImage(stegoHideImage, 0, 0);

      try {
        let imgData = ctxOff.getImageData(0, 0, canvasOff.width, canvasOff.height);
        imgData = encodeLSB(imgData, message);
        ctxOff.putImageData(imgData, 0, 0);

        const link = document.createElement('a');
        link.download = 'stego_image.png';
        link.href = canvasOff.toDataURL('image/png');
        link.click();
      } catch (err) {
        showStegoError(stegoHideError, err.message);
      }
    });

    const stegoExtractInput = document.getElementById('stego-extract-input');
    const stegoExtractDropzone = document.getElementById('stego-extract-dropzone');
    const stegoExtractFilename = document.getElementById('stego-extract-filename');
    const stegoExtractError = document.getElementById('stego-extract-error');
    const stegoExtractBtn = document.getElementById('stego-extract-btn');
    const stegoExtractResult = document.getElementById('stego-extract-result');

    setupStegoDropzone(stegoExtractDropzone, stegoExtractInput, (file) => {
      stegoExtractFilename.textContent = file.name;
      stegoExtractFilename.classList.remove('hidden');
      stegoExtractError.classList.add('hidden');

      const reader = new FileReader();
      reader.onload = (e) => {
        stegoExtractImage = new Image();
        stegoExtractImage.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });

    stegoExtractBtn.addEventListener('click', () => {
      stegoExtractError.classList.add('hidden');
      stegoExtractResult.value = '';

      if (!stegoExtractImage) {
        showStegoError(stegoExtractError, "Please upload a stego image first.");
        return;
      }

      const canvasOff = document.createElement('canvas');
      canvasOff.width = stegoExtractImage.width;
      canvasOff.height = stegoExtractImage.height;
      const ctxOff = canvasOff.getContext('2d');
      ctxOff.drawImage(stegoExtractImage, 0, 0);

      try {
        const imgData = ctxOff.getImageData(0, 0, canvasOff.width, canvasOff.height);
        const secret = decodeLSB(imgData);
        stegoExtractResult.value = secret;
      } catch (err) {
        showStegoError(stegoExtractError, err.message);
      }
    });

    function setupStegoDropzone(dropzoneEl, inputEl, callback) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzoneEl.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, false);
      });

      ['dragenter', 'dragover'].forEach(eventName => {
        dropzoneEl.addEventListener(eventName, () => {
          dropzoneEl.classList.add('border-cyberCyan', 'shadow-cyan-glow');
        }, false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropzoneEl.addEventListener(eventName, () => {
          dropzoneEl.classList.remove('border-cyberCyan', 'shadow-cyan-glow');
        }, false);
      });

      dropzoneEl.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file) callback(file);
      });

      inputEl.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) callback(file);
      });
    }

    function showStegoError(el, msg) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }

    function encodeLSB(imageData, message) {
      const encoder = new TextEncoder();
      const msgBytes = encoder.encode(message);
      const totalLength = msgBytes.length;
      
      const payload = new Uint8Array(4 + totalLength);
      payload[0] = (totalLength >> 24) & 0xFF;
      payload[1] = (totalLength >> 16) & 0xFF;
      payload[2] = (totalLength >> 8) & 0xFF;
      payload[3] = totalLength & 0xFF;
      payload.set(msgBytes, 4);

      const data = imageData.data;
      let bitIndex = 0;
      const totalBits = payload.length * 8;

      if (totalBits > (data.length / 4) * 3) {
        throw new Error("Message is too long for the selected image size.");
      }

      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          if (bitIndex < totalBits) {
            const bytePos = Math.floor(bitIndex / 8);
            const bitPos = 7 - (bitIndex % 8);
            const bit = (payload[bytePos] >> bitPos) & 1;

            data[i + c] = (data[i + c] & 0xFE) | bit;
            bitIndex++;
          } else {
            return imageData;
          }
        }
      }
      return imageData;
    }

    function decodeLSB(imageData) {
      const data = imageData.data;
      let bitIndex = 0;
      
      let lengthBytes = new Uint8Array(4);
      const maxPixels = data.length / 4;
      const maxBits = maxPixels * 3;
      
      let lengthRead = false;
      let totalLength = 0;
      let payloadBytes = null;

      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const bit = data[i + c] & 1;

          if (!lengthRead) {
            const bytePos = Math.floor(bitIndex / 8);
            const bitPos = 7 - (bitIndex % 8);
            lengthBytes[bytePos] |= (bit << bitPos);
            bitIndex++;

            if (bitIndex === 32) {
              totalLength = (((lengthBytes[0] << 24) | (lengthBytes[1] << 16) | (lengthBytes[2] << 8) | lengthBytes[3]) >>> 0);
              if (totalLength < 0 || totalLength > maxBits / 8) {
                throw new Error("No hidden message found or invalid message length.");
              }
              payloadBytes = new Uint8Array(totalLength);
              lengthRead = true;
            }
          } else {
            const payloadBitIndex = bitIndex - 32;
            const bytePos = Math.floor(payloadBitIndex / 8);
            const bitPos = 7 - (payloadBitIndex % 8);
            
            if (bytePos < totalLength) {
              payloadBytes[bytePos] |= (bit << bitPos);
              bitIndex++;
            } else {
              const decoder = new TextDecoder();
              return decoder.decode(payloadBytes);
            }
          }
        }
      }
      
      if (payloadBytes) {
        const decoder = new TextDecoder();
        return decoder.decode(payloadBytes);
      }
      throw new Error("Image ends before full message could be extracted.");
    }

    // ==========================================
    // BARLINE CIPHER DECODER MODULE
    // ==========================================
    const barlineInput = document.getElementById('barline-input');
    const barlineClearBtn = document.getElementById('barline-clear-btn');
    const barlineDecodeBtn = document.getElementById('barline-decode-btn');
    const barlineDigits = document.getElementById('barline-digits');
    const barlinePlaintext = document.getElementById('barline-plaintext');
    const barlineMappingBadge = document.getElementById('barline-mapping-badge');

    barlineClearBtn.addEventListener('click', () => {
      barlineInput.value = '';
      barlineDigits.value = '';
      barlinePlaintext.value = '';
      barlineMappingBadge.classList.add('hidden');
    });

    barlineDecodeBtn.addEventListener('click', runBarlineDecode);

    function runBarlineDecode() {
      const text = barlineInput.value;
      barlineDigits.value = '';
      barlinePlaintext.value = '';
      barlineMappingBadge.classList.add('hidden');

      const barChars = [];
      for (const char of text) {
        if (char === '\u{1D100}' || char === '\u{1D101}' || char === '\u{1D102}' || char === '\u{1D103}') {
          barChars.push(char);
        }
      }

      if (barChars.length === 0) {
        barlinePlaintext.value = "No Unicode musical barlines (𝄀, 𝄁, 𝄂, 𝄃) found in the input.";
        return;
      }

      // Convert to base-4 digits
      const digits = barChars.map(c => {
        if (c === '\u{1D100}') return '0';
        if (c === '\u{1D101}') return '1';
        if (c === '\u{1D102}') return '2';
        if (c === '\u{1D103}') return '3';
        return '';
      }).join('');
      barlineDigits.value = digits;

      // Brute force permutations
      const bitValues = ['00', '01', '10', '11'];
      const allPermutations = getPermutations(bitValues);

      let bestScore = -1;
      let bestText = '';
      let bestMapping = null;
      let bestHex = '';

      for (const perm of allPermutations) {
        let bitString = '';
        for (const char of barChars) {
          if (char === '\u{1D100}') bitString += perm[0];
          else if (char === '\u{1D101}') bitString += perm[1];
          else if (char === '\u{1D102}') bitString += perm[2];
          else if (char === '\u{1D103}') bitString += perm[3];
        }

        const bytes = [];
        for (let i = 0; i < bitString.length; i += 8) {
          if (i + 8 <= bitString.length) {
            bytes.push(parseInt(bitString.slice(i, i + 8), 2));
          }
        }
        if (bytes.length === 0) continue;

        let printableCount = 0;
        let decodedText = '';
        let hexParts = [];
        for (const b of bytes) {
          decodedText += String.fromCharCode(b);
          hexParts.push(b.toString(16).padStart(2, '0').toUpperCase());
          if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
            printableCount++;
          }
        }

        const score = printableCount / bytes.length;
        if (score > bestScore) {
          bestScore = score;
          bestText = decodedText;
          bestMapping = perm;
          bestHex = hexParts.join(' ');
        }
      }

      if (bestScore >= 0.8) {
        // Show mapping rules neon badge
        barlineMappingBadge.textContent = `𝄀=${bestMapping[0]} 𝄁=${bestMapping[1]} 𝄂=${bestMapping[2]} 𝄃=${bestMapping[3]}`;
        barlineMappingBadge.classList.remove('hidden');
        barlinePlaintext.value = bestText;
      } else {
        // Fallback display
        barlinePlaintext.value = `[NO CLEAR ASCII PLAINTEXT FOUND. SHOWING HIGHEST SCORING PREVIEW / HEX FALLBACK]\n\nDecoded Bytes (HEX):\n${bestHex}\n\nRaw Text Fallback:\n${bestText}`;
      }
    }

    function runBarlineSmartDecodeQuiet(inputText) {
      const barChars = [];
      for (const char of inputText) {
        if (char === '\u{1D100}' || char === '\u{1D101}' || char === '\u{1D102}' || char === '\u{1D103}') {
          barChars.push(char);
        }
      }
      if (barChars.length === 0) return '';
      
      const bitValues = ['00', '01', '10', '11'];
      const allPermutations = getPermutations(bitValues);
      
      let bestScore = -1;
      let bestText = '';
      
      for (const perm of allPermutations) {
        let bitString = '';
        for (const char of barChars) {
          if (char === '\u{1D100}') bitString += perm[0];
          else if (char === '\u{1D101}') bitString += perm[1];
          else if (char === '\u{1D102}') bitString += perm[2];
          else if (char === '\u{1D103}') bitString += perm[3];
        }
        
        const bytes = [];
        for (let i = 0; i < bitString.length; i += 8) {
          if (i + 8 <= bitString.length) {
            bytes.push(parseInt(bitString.slice(i, i + 8), 2));
          }
        }
        if (bytes.length === 0) continue;
        
        let printableCount = 0;
        let text = '';
        for (const b of bytes) {
          text += String.fromCharCode(b);
          if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
            printableCount++;
          }
        }
        const score = printableCount / bytes.length;
        if (score > bestScore) {
          bestScore = score;
          bestText = text;
        }
      }
      return bestText || '[No readable data]';
    }

    function getPermutations(arr) {
      if (arr.length === 0) return [[]];
      const first = arr[0];
      const rest = arr.slice(1);
      const permsWithoutFirst = getPermutations(rest);
      const allPerms = [];
      for (const perm of permsWithoutFirst) {
        for (let i = 0; i <= perm.length; i++) {
          const p = [...perm];
          p.splice(i, 0, first);
          allPerms.push(p);
        }
      }
      return allPerms;
    }

    // ==========================================
    // METADATA & FILE ANALYZER MODULE
    // ==========================================
    const metadataDropzone = document.getElementById('metadata-dropzone');
    const metadataFileInput = document.getElementById('metadata-file-input');
    const metadataLoadedFilename = document.getElementById('metadata-loaded-filename');
    const metadataFilenameVal = document.getElementById('metadata-filename-val');
    const metadataFilesizeVal = document.getElementById('metadata-filesize-val');
    const metadataMimeVal = document.getElementById('metadata-mime-val');
    const metadataModifiedVal = document.getElementById('metadata-modified-val');
    const metadataHexVal = document.getElementById('metadata-hex-val');
    const metadataTypeVal = document.getElementById('metadata-type-val');
    const metadataGeometrySection = document.getElementById('metadata-geometry-section');
    const metadataDimensionsVal = document.getElementById('metadata-dimensions-val');
    const metadataAspectVal = document.getElementById('metadata-aspect-val');

    // Drag-and-drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      metadataDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      metadataDropzone.addEventListener(eventName, () => {
        metadataDropzone.classList.remove('border-cyberBorder');
        metadataDropzone.classList.add('border-cyberCyan', 'shadow-cyan-glow');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      metadataDropzone.addEventListener(eventName, () => {
        metadataDropzone.classList.add('border-cyberBorder');
        metadataDropzone.classList.remove('border-cyberCyan', 'shadow-cyan-glow');
      }, false);
    });

    metadataDropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) {
        handleMetadataFile(file);
      }
    });

    metadataFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleMetadataFile(file);
      }
    });

    let activeFilePath = null;

    const metadataStegoPanel = document.getElementById('metadata-stego-panel');
    const metadataStegoScanBtn = document.getElementById('metadata-stego-scan-btn');
    const metadataStegoResults = document.getElementById('metadata-stego-results');
    const metadataStegoEofStatus = document.getElementById('metadata-stego-eof-status');
    const metadataStegoFilesList = document.getElementById('metadata-stego-files-list');
    const metadataStegoStringsVal = document.getElementById('metadata-stego-strings-val');

    async function handleMetadataFile(file) {
      // Store active file path for stego scanning
      activeFilePath = file.path;

      // Reset displays
      metadataFilenameVal.textContent = '-';
      metadataFilesizeVal.textContent = '-';
      metadataMimeVal.textContent = '-';
      metadataModifiedVal.textContent = '-';
      metadataHexVal.textContent = '-';
      metadataTypeVal.textContent = '-';
      metadataDimensionsVal.textContent = '-';
      metadataAspectVal.textContent = '-';
      metadataGeometrySection.classList.add('hidden');

      // Reset stego panel UI state
      metadataStegoPanel.classList.remove('hidden');
      metadataStegoScanBtn.classList.remove('hidden');
      metadataStegoScanBtn.disabled = false;
      metadataStegoScanBtn.textContent = 'Run Deep Stego Scan';
      metadataStegoResults.classList.add('hidden');
      metadataStegoEofStatus.className = 'p-3 rounded border font-mono text-xs';
      metadataStegoEofStatus.textContent = '-';
      metadataStegoFilesList.innerHTML = '<li class="text-slate-500 italic">No embedded file signatures detected</li>';
      metadataStegoStringsVal.textContent = 'Waiting for scan initiation...';

      // Update filename badge in dropzone
      metadataLoadedFilename.textContent = file.name;
      metadataLoadedFilename.classList.remove('hidden');

      try {
        const result = await window.api.analyzeFile(file.path);
        if (result.success) {
          metadataFilenameVal.textContent = result.name;
          metadataFilesizeVal.textContent = result.size;
          metadataMimeVal.textContent = result.mime;
          metadataModifiedVal.textContent = result.lastModified;
          metadataHexVal.textContent = result.hex;
          metadataTypeVal.textContent = result.type;

          if (result.isImage && result.width && result.height) {
            metadataDimensionsVal.textContent = `${result.width} x ${result.height} pixels`;
            metadataAspectVal.textContent = result.aspect || 'N/A';
            metadataGeometrySection.classList.remove('hidden');
          }
        } else {
          throw new Error(result.error);
        }
      } catch (err) {
        console.error("File analysis failed:", err);
        metadataFilenameVal.textContent = file.name;
        metadataHexVal.textContent = "ERROR";
        metadataTypeVal.textContent = "Analysis Failed: " + err.message;
      }
    }

    metadataStegoScanBtn.addEventListener('click', async () => {
      if (!activeFilePath) return;

      metadataStegoScanBtn.disabled = true;
      metadataStegoScanBtn.textContent = 'Scanning...';
      metadataStegoResults.classList.remove('hidden');

      metadataStegoEofStatus.className = 'p-3 rounded border border-cyberCyan/20 bg-cyberCyan/5 text-cyberCyan animate-pulse';
      metadataStegoEofStatus.textContent = 'Analyzing file structure for EOF overlays...';
      metadataStegoFilesList.innerHTML = '<li class="text-slate-400 italic animate-pulse">Scanning binary offsets for magic bytes...</li>';
      metadataStegoStringsVal.textContent = 'Extracting ASCII string sequences...';

      try {
        const result = await window.api.scanSteganography(activeFilePath);
        
        if (result.success) {
          metadataStegoScanBtn.textContent = 'Scan Complete';

          // A. EOF Overlay rendering
          if (result.eofOverlay.detected) {
            metadataStegoEofStatus.className = 'p-3 rounded border border-cyberMagenta/30 bg-cyberMagenta/10 text-cyberMagenta shadow-[0_0_15px_rgba(255,0,127,0.15)]';
            metadataStegoEofStatus.innerHTML = `
              <div class="font-bold text-sm tracking-wide mb-1">PAYLOAD OVERLAY DETECTED!</div>
              <div>Appended data exists past the structural EOF boundary.</div>
              <div class="mt-2 text-[10px] text-slate-400">Offset: <span class="text-white">${result.eofOverlay.offset}</span> | Size: <span class="text-white">${result.eofOverlay.payloadSize} bytes</span> | Type: <span class="text-white uppercase">${result.eofOverlay.payloadType}</span></div>
              <div class="mt-3">
                <span class="text-[9px] uppercase text-slate-500 block mb-1">Payload Content/Hex:</span>
                <pre class="bg-black/40 border border-cyberMagenta/20 text-cyberMagenta p-2 rounded text-[10px] whitespace-pre-wrap max-h-32 overflow-y-auto break-all font-mono">${escapeHTML(result.eofOverlay.payloadPreview)}</pre>
              </div>
            `;
          } else {
            metadataStegoEofStatus.className = 'p-3 rounded border border-cyberGreen/30 bg-cyberGreen/10 text-cyberGreen shadow-[0_0_15px_rgba(57,255,20,0.15)]';
            metadataStegoEofStatus.innerHTML = `
              <div class="font-bold text-sm tracking-wide">EOF STATUS CLEAR</div>
              <div class="mt-1 text-slate-400">No appended data payload found past standard file headers.</div>
            `;
          }

          // B. Embedded files rendering
          if (result.embeddedFiles.length > 0) {
            metadataStegoFilesList.innerHTML = '';
            result.embeddedFiles.forEach(fileInfo => {
              const li = document.createElement('li');
              li.className = 'text-cyberMagenta font-semibold flex items-center gap-2';
              li.innerHTML = `
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-cyberMagenta shadow-[0_0_5px_#ff007f]"></span>
                <span>${escapeHTML(fileInfo.message)}</span>
              `;
              metadataStegoFilesList.appendChild(li);
            });
          } else {
            metadataStegoFilesList.innerHTML = '<li class="text-cyberGreen font-semibold">No nested signature matches (ZIP/PDF) detected.</li>';
          }

          // C. Extracted strings rendering
          if (result.extractedStrings.length > 0) {
            metadataStegoStringsVal.textContent = result.extractedStrings.join('\n');
          } else {
            metadataStegoStringsVal.textContent = 'No printable ASCII string sequences matching rules were found.';
          }
        } else {
          throw new Error(result.error);
        }
      } catch (err) {
        console.error('Steganography scan failed:', err);
        metadataStegoEofStatus.className = 'p-3 rounded border border-red-500/30 bg-red-500/10 text-red-400';
        metadataStegoEofStatus.textContent = 'Scan failed: ' + err.message;
        metadataStegoFilesList.innerHTML = '<li class="text-red-400">Error executing signature scan</li>';
        metadataStegoStringsVal.textContent = 'Error: ' + err.message;
        metadataStegoScanBtn.textContent = 'Scan Failed';
      }
    });
    // ==========================================
    // OUTGUESS DECODER MODULE
    // ==========================================
    const outguessDropzone = document.getElementById('outguess-dropzone');
    const outguessFileInput = document.getElementById('outguess-file-input');
    const outguessLoadedFilename = document.getElementById('outguess-loaded-filename');
    const outguessKeyInput = document.getElementById('outguess-key');
    const outguessExecuteBtn = document.getElementById('outguess-execute-btn');
    const outguessTerminal = document.getElementById('outguess-terminal');
    
    let activeOutguessFilePath = null;

    // Drag-and-drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      outguessDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      outguessDropzone.addEventListener(eventName, () => {
        outguessDropzone.classList.remove('border-cyberBorder');
        outguessDropzone.classList.add('border-cyberMagenta', 'shadow-[0_0_10px_#ff007f]');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      outguessDropzone.addEventListener(eventName, () => {
        outguessDropzone.classList.add('border-cyberBorder');
        outguessDropzone.classList.remove('border-cyberMagenta', 'shadow-[0_0_10px_#ff007f]');
      }, false);
    });

    outguessDropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleOutguessFile(file);
    });

    outguessFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleOutguessFile(file);
    });

    function handleOutguessFile(file) {
      const isJpeg = file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg');
      if (!isJpeg) {
        outguessTerminal.className = 'h-32 overflow-y-auto font-mono text-xs text-red-500 whitespace-pre-wrap select-text';
        outguessTerminal.textContent = 'ERROR: OutGuess steganography is designed only for JPEG images (.jpg or .jpeg).';
        activeOutguessFilePath = null;
        outguessLoadedFilename.classList.add('hidden');
        return;
      }

      activeOutguessFilePath = file.path;
      outguessLoadedFilename.textContent = file.name;
      outguessLoadedFilename.classList.remove('hidden');
      
      outguessTerminal.className = 'h-32 overflow-y-auto font-mono text-xs text-cyberGreen/90 whitespace-pre-wrap select-text';
      outguessTerminal.textContent = `Target image locked: ${file.name}\nEnter stego key (if any), then click Execute...`;
      outguessExecuteBtn.textContent = 'Execute OutGuess Extraction';
    }

    outguessExecuteBtn.addEventListener('click', async () => {
      if (!activeOutguessFilePath) {
        outguessTerminal.className = 'h-32 overflow-y-auto font-mono text-xs text-red-500 whitespace-pre-wrap select-text';
        outguessTerminal.textContent = 'ERROR: No stego JPEG loaded. Please drop a valid JPEG file first.';
        return;
      }

      outguessExecuteBtn.disabled = true;
      outguessExecuteBtn.textContent = 'Extracting...';
      outguessTerminal.className = 'h-32 overflow-y-auto font-mono text-xs text-cyberCyan whitespace-pre-wrap select-text animate-pulse';
      outguessTerminal.textContent = 'OutGuess extraction initialized. Spawning background binary process...\nPerforming discrete coefficient analysis...';

      // Sanitize inputs: trim and strip dangerous shell meta-characters just in case
      const rawKey = outguessKeyInput.value || '';
      const key = rawKey.trim().replace(/[\n\r]/g, ''); // strip newlines

      try {
        const result = await window.api.runOutguess(activeOutguessFilePath, key);
        outguessExecuteBtn.disabled = false;

        if (result.success) {
          outguessExecuteBtn.textContent = 'Extraction Succeeded';
          outguessTerminal.className = 'h-32 overflow-y-auto font-mono text-xs text-cyberGreen/90 whitespace-pre-wrap select-text';
          
          let terminalOutput = '';
          if (result.stderr) {
            terminalOutput += `[WSL Process Log (stderr)]:\n${result.stderr}\n\n`;
          }
          if (result.stdout) {
            terminalOutput += `[WSL Process Log (stdout)]:\n${result.stdout}\n\n`;
          }
          terminalOutput += `[Extracted Data Payload]:\n${result.data || '[Empty payload or non-text content]'}`;
          outguessTerminal.textContent = terminalOutput;
        } else {
          throw new Error(result.error);
        }
      } catch (err) {
        outguessExecuteBtn.disabled = false;
        outguessExecuteBtn.textContent = 'Extraction Failed';
        outguessTerminal.className = 'h-32 overflow-y-auto font-mono text-xs text-red-500 whitespace-pre-wrap select-text';
        outguessTerminal.textContent = `OutGuess WSL bridge failed:\n${err.message}`;
      }
    });

    // ==========================================
    // GLOBAL UTILITIES (CLIPBOARD COPY)
    // ==========================================
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-copy-target');
        const targetEl = document.getElementById(targetId);
        
        if (targetEl && targetEl.value) {
          navigator.clipboard.writeText(targetEl.value).then(() => {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `
              <svg class="w-3.5 h-3.5 text-cyberGreen" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
              COPIED!
            `;
            btn.classList.remove('text-cyberCyan', 'border-cyberCyan/20');
            btn.classList.add('text-cyberGreen', 'border-cyberGreen/30');

            setTimeout(() => {
              btn.innerHTML = originalHTML;
              btn.classList.remove('text-cyberGreen', 'border-cyberGreen/30');
              btn.classList.add('text-cyberCyan', 'border-cyberCyan/20');
            }, 1500);
          });
        }
      });
    });
    