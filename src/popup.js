document.addEventListener('DOMContentLoaded', function() {
  // UI elements - Main
  const configsContainer = document.getElementById('configs-container');
  const addConfigButton = document.getElementById('add-config');
  const saveButton = document.getElementById('save-configs');
  const showHelpButton = document.getElementById('show-help');
  const helpSection = document.getElementById('help-section');
  const mainInterface = document.getElementById('main-interface');
  const backToSettingsButton = document.getElementById('back-to-settings');
  const themeToggle = document.getElementById('theme-toggle');
  
  // UI elements - LLM
  const llmSettingsBtn = document.getElementById('llm-settings-btn');
  const llmInterface = document.getElementById('llm-interface');
  const backToMainBtn = document.getElementById('back-to-main-btn');
  const saveLlmSettingsBtn = document.getElementById('save-llm-settings-btn');
  const llmEnabledToggle = document.getElementById('llm-enabled-toggle');
  
  // These IDs now match your HTML exactly
  const llmApiUrlInput = document.getElementById('llm-api-url');
  const llmApiKeyInput = document.getElementById('llm-api-key');
  const llmModelInput = document.getElementById('llm-model'); // Re-added to match your HTML

  let gameConfigs = [];
  let darkMode = false;
  
  // Fetch all settings, including the 'llmModel' to populate the form
  chrome.storage.sync.get([
    'darkMode', 
    'gameConfigs', 
    'useLLM', 
    'llmApiKey', 
    'llmModelEndpoint',
    'llmModel' // Fetch the saved model name
  ], function(data) {
    // Theme
    darkMode = data.darkMode || false;
    updateTheme();
    
    // Keyword Configs
    gameConfigs = data.gameConfigs || [];
    renderConfigs();

    // Load LLM settings
    llmEnabledToggle.checked = data.useLLM || false;
    // The background.js uses 'llmModelEndpoint', so we load from that key
    llmApiUrlInput.value = data.llmModelEndpoint || ''; 
    llmApiKeyInput.value = data.llmApiKey || '';
    // Populate the model input field
    llmModelInput.value = data.llmModel || '';
  });
  
  // Theme toggle
  themeToggle.addEventListener('click', function() {
    darkMode = !darkMode;
    updateTheme();
    chrome.storage.sync.set({ darkMode });
  });
  
  function updateTheme() {
    document.body.classList.toggle('dark-mode', darkMode);
    themeToggle.style.backgroundImage = `url(${darkMode ? 
      'https://www.geeksvgs.com/files/2019/02/934ce_shining_sun.png' : 
      'https://www.pngall.com/wp-content/uploads/5/Black-Crescent-Moon-PNG.png'})`;
  }
  
  // Create HTML for each game config (This function remains unchanged)
  function renderConfigs() {
    configsContainer.innerHTML = '';
    
    gameConfigs.forEach((config, index) => {
      const configDiv = document.createElement('div');
      configDiv.className = 'config-section';
      
      configDiv.innerHTML = `
        <div class="config-header ${config.enabled === false ? 'disabled' : ''}">
          <h3 class="config-title">${config.name || 'New Rule'}</h3>
          <div class="toggle-container">
            <label class="toggle-switch">
              <input type="checkbox" ${config.enabled === false ? '' : 'checked'}>
              <span class="slider"></span>
            </label>
          </div>
        </div>
        <div class="config-content ${config.enabled === false ? 'disabled' : ''}">
          <div class="form-group">
            <label>Rule Name:</label>
            <input type="text" class="game-name" value="${config.name || ''}" placeholder="e.g., Minecraft Mods">
          </div>
          <div class="form-group">
            <label>Keywords (comma separated):</label>
            <input type="text" class="keywords" value="${config.keywords || ''}" placeholder="minecraft, mc, forge">
          </div>
          <div class="form-group">
            <label>Download Path:</label>
            <input type="text" class="download-path" value="${config.downloadPath || ''}" placeholder="C:/Games/Minecraft/mods/">
          </div>
          <button class="remove-btn" data-index="${index}">Remove Rule</button>
        </div>
      `;
      
      configsContainer.appendChild(configDiv);
      
      const toggle = configDiv.querySelector('.toggle-switch input');
      toggle.addEventListener('change', function() {
        gameConfigs[index].enabled = this.checked;
        configDiv.querySelector('.config-header').classList.toggle('disabled', !this.checked);
        configDiv.querySelector('.config-content').classList.toggle('disabled', !this.checked);
      });
    });
    
    document.querySelectorAll('.remove-btn').forEach(button => {
      button.addEventListener('click', function() {
        const index = parseInt(this.getAttribute('data-index'));
        gameConfigs.splice(index, 1);
        renderConfigs();
      });
    });
  }
  
  // Add new config (This function remains unchanged)
  addConfigButton.addEventListener('click', function() {
    gameConfigs.push({
      name: '',
      keywords: '',
      downloadPath: '',
      enabled: true
    });
    renderConfigs();
  });
  
  // Save keyword-based configs (This function remains unchanged)
  saveButton.addEventListener('click', function() {
    const gameNameInputs = document.querySelectorAll('.game-name');
    const keywordsInputs = document.querySelectorAll('.keywords');
    const downloadPathInputs = document.querySelectorAll('.download-path');
    
    const updatedConfigs = [];
    
    for (let i = 0; i < gameNameInputs.length; i++) {
      let downloadPath = downloadPathInputs[i].value.trim();
      if (downloadPath && !downloadPath.endsWith('/') && !downloadPath.endsWith('\\')) {
        downloadPath += '/';
      }
      
      updatedConfigs.push({
        name: gameNameInputs[i].value.trim(),
        keywords: keywordsInputs[i].value.trim(),
        downloadPath: downloadPath,
        enabled: gameConfigs[i] ? gameConfigs[i].enabled !== false : true
      });
    }
    
    gameConfigs = updatedConfigs;
    
    chrome.storage.sync.set({ gameConfigs }, function() {
      showSaveMessage(saveButton, 'Settings saved!');
    });
  });

  // --- LLM Settings Logic ---
  llmSettingsBtn.addEventListener('click', () => {
    mainInterface.style.display = 'none';
    llmInterface.style.display = 'block';
  });

  backToMainBtn.addEventListener('click', () => {
    llmInterface.style.display = 'none';
    mainInterface.style.display = 'block';
  });

  // Save LLM settings
  saveLlmSettingsBtn.addEventListener('click', () => {
    chrome.storage.sync.set({
      // Keys used by background.js
      useLLM: llmEnabledToggle.checked,
      llmModelEndpoint: llmApiUrlInput.value.trim(), // The input with id 'llm-api-url' saves to 'llmModelEndpoint'
      llmApiKey: llmApiKeyInput.value.trim(),
      
      // We also save the model name, even if background.js doesn't use it yet.
      // This is good practice for future-proofing.
      llmModel: llmModelInput.value.trim()

    }, () => {
        showSaveMessage(saveLlmSettingsBtn, 'LLM settings saved!');
    });
  });
  
  // --- Help Section Logic (This section remains unchanged) ---
  showHelpButton.addEventListener('click', function() {
    mainInterface.style.display = 'none';
    helpSection.style.display = 'block';
  });
  
  backToSettingsButton.addEventListener('click', function() {
    helpSection.style.display = 'none';
    mainInterface.style.display = 'block';
  });

  // --- Utility Functions (This section remains unchanged) ---
  function showSaveMessage(buttonElement, message) {
    const existingMessage = buttonElement.nextElementSibling;
    if (existingMessage && existingMessage.classList.contains('save-message')) {
        existingMessage.remove();
    }
      
    const saveMessage = document.createElement('div');
    saveMessage.className = 'save-message';
    saveMessage.textContent = message;
    saveMessage.style.color = 'green';
    saveMessage.style.padding = '10px';
    saveMessage.style.textAlign = 'center';
    
    buttonElement.insertAdjacentElement('afterend', saveMessage);
    
    setTimeout(() => {
      saveMessage.remove();
    }, 2000);
  }
});