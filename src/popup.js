// popup.js
document.addEventListener('DOMContentLoaded', function() {
  // UI elements
  const configsContainer = document.getElementById('configs-container');
  const addConfigButton = document.getElementById('add-config');
  const saveButton = document.getElementById('save-configs');
  const showHelpButton = document.getElementById('show-help');
  const helpSection = document.getElementById('help-section');
  const mainInterface = document.getElementById('main-interface');
  const backToSettingsButton = document.getElementById('back-to-settings');
  const themeToggle = document.getElementById('theme-toggle');
  
  let gameConfigs = [];
  let darkMode = false;
  
  // Initialize theme
  chrome.storage.sync.get(['darkMode', 'gameConfigs'], function(data) {
    darkMode = data.darkMode || false;
    updateTheme();
    
    if (data.gameConfigs && data.gameConfigs.length > 0) {
      gameConfigs = data.gameConfigs;
      renderConfigs();
    } else {
      gameConfigs = [];
      renderConfigs();
    }
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
      
      // Add event listener to toggle switch
      const toggle = configDiv.querySelector('.toggle-switch input');
      toggle.addEventListener('change', function() {
        gameConfigs[index].enabled = this.checked;
        configDiv.querySelector('.config-header').classList.toggle('disabled', !this.checked);
        configDiv.querySelector('.config-content').classList.toggle('disabled', !this.checked);
      });
    });
    
    // Add event listeners to remove buttons
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
  
  // Save configs
  saveButton.addEventListener('click', function() {
    // Update configs from form values
    const gameNameInputs = document.querySelectorAll('.game-name');
    const keywordsInputs = document.querySelectorAll('.keywords');
    const downloadPathInputs = document.querySelectorAll('.download-path');
    
    const updatedConfigs = [];
    
    for (let i = 0; i < gameNameInputs.length; i++) {
      // Ensure download paths end with a slash
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
    
    // Save to storage
    chrome.storage.sync.set({ gameConfigs }, function() {
      const saveMessage = document.createElement('div');
      saveMessage.textContent = 'Settings saved!';
      saveMessage.style.color = 'green';
      saveMessage.style.padding = '10px';
      saveMessage.style.textAlign = 'center';
      
      saveButton.insertAdjacentElement('afterend', saveMessage);
      
      setTimeout(() => {
        saveMessage.remove();
      }, 2000);
    });
  });
  
  // Show/hide help section
  showHelpButton.addEventListener('click', function() {
    mainInterface.style.display = 'none';
    helpSection.style.display = 'block';
  });
  
  backToSettingsButton.addEventListener('click', function() {
    helpSection.style.display = 'none';
    mainInterface.style.display = 'block';
  });
});