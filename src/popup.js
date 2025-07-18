document.addEventListener('DOMContentLoaded', function() {
  // --- UI Elements ---
  const mainInterface = document.getElementById('main-interface');
  const helpSection = document.getElementById('help-section');
  const welcomeMessage = document.getElementById('first-install-welcome');
  const showHelpButton = document.getElementById('show-help');
  const backToSettingsButton = document.getElementById('back-to-settings');
  const configsContainer = document.getElementById('configs-container');
  const addConfigButton = document.getElementById('add-config');
  const saveButton = document.getElementById('save-configs');
  const themeToggle = document.getElementById('theme-toggle');
  const llmSettingsBtn = document.getElementById('llm-settings-btn');
  const llmInterface = document.getElementById('llm-interface');
  const backToMainBtn = document.getElementById('back-to-main-btn');
  const saveLlmSettingsBtn = document.getElementById('save-llm-settings-btn');
  const llmEnabledToggle = document.getElementById('llm-enabled-toggle');
  const llmApiUrlInput = document.getElementById('llm-api-url');
  const llmApiKeyInput = document.getElementById('llm-api-key');
  const llmModelInput = document.getElementById('llm-model');

  let gameConfigs = [];
  let darkMode = false;

  chrome.storage.sync.get(['hasOpenedBefore'], function(result) {
    if (!result.hasOpenedBefore) {
      mainInterface.style.display = 'none';
      helpSection.style.display = 'block';
      
      chrome.storage.sync.set({ hasOpenedBefore: true });
    } else {
      if (welcomeMessage) {
        welcomeMessage.remove();
      }
    }
  });

  // --- Loads All Settings ---
  chrome.storage.sync.get([
    'darkMode', 
    'gameConfigs', 
    'useLLM', 
    'llmApiKey', 
    'llmModelEndpoint',
    'llmModel'
  ], function(data) {
    // Theme
    darkMode = data.darkMode || false;
    updateTheme();
    
    // Keyword Configs
    gameConfigs = data.gameConfigs || [];
    renderConfigs();

    // Load LLM settings
    llmEnabledToggle.checked = data.useLLM || false;
    llmApiUrlInput.value = data.llmModelEndpoint || ''; 
    llmApiKeyInput.value = data.llmApiKey || '';
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
  
  // Create HTML for each game config
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
            <input type="text" class="game-name" value="${config.name || ''}" placeholder="e.g., The Sims 4 Mods">
          </div>
          <div class="form-group">
            <label>Keywords (comma separated):</label>
            <input type="text" class="keywords" value="${config.keywords || ''}" placeholder="ts4, the sims 4, thesims4, sims 4">
          </div>
          <div class="form-group">
            <label>Download Path:</label>
            <input type="text" class="download-path" value="${config.downloadPath || ''}" placeholder="E:/Games/The Sims 4/mods/">
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
  
  // Add new config
  addConfigButton.addEventListener('click', function() {
    gameConfigs.push({
      name: '',
      keywords: '',
      downloadPath: '',
      enabled: true
    });
    renderConfigs();
  });
  
  // Save keyword-based configs
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
      useLLM: llmEnabledToggle.checked,
      llmModelEndpoint: llmApiUrlInput.value.trim(),
      llmApiKey: llmApiKeyInput.value.trim(),
      llmModel: llmModelInput.value.trim()
    }, () => {
        showSaveMessage(saveLlmSettingsBtn, 'LLM settings saved!');
    });
  });
  
  // --- Help Section Logic ---
  showHelpButton.addEventListener('click', function() {
    mainInterface.style.display = 'none';
    helpSection.style.display = 'block';
  });
  
  backToSettingsButton.addEventListener('click', function() {
    helpSection.style.display = 'none';
    mainInterface.style.display = 'block';
  });

  // --- Utility Functions ---
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