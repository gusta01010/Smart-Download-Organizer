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
  
  let gameConfigs = [];
  
  // Load existing configs
  chrome.storage.sync.get('gameConfigs', function(data) {
    if (data.gameConfigs && data.gameConfigs.length > 0) {
      gameConfigs = data.gameConfigs;
      renderConfigs();
    } else { // Changed the initialization to an empty list
        gameConfigs = [];
        renderConfigs();
    }
  });
  
  // Create HTML for each game config
  function renderConfigs() {
    configsContainer.innerHTML = '';
    
    gameConfigs.forEach((config, index) => {
      const configDiv = document.createElement('div');
      configDiv.className = 'game-config';
      configDiv.innerHTML = `
        <label>Game Name:</label>
        <input type="text" class="game-name" value="${config.name || ''}" placeholder="e.g., Minecraft">
        
        <label>Keywords (comma separated):</label>
        <input type="text" class="keywords" value="${config.keywords || ''}" placeholder="minecraft, mc, forge">
        
        <label>Download Path:</label>
        <input type="text" class="download-path" value="${config.downloadPath || ''}" placeholder="C:/Games/Minecraft/mods/">
        
        <button class="remove-config" data-index="${index}">Remove</button>
      `;
      
      configsContainer.appendChild(configDiv);
    });
    
    // Add event listeners to remove buttons
    document.querySelectorAll('.remove-config').forEach(button => {
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
      downloadPath: ''
    });
    renderConfigs();
  });
  
  // Save configs
  saveButton.addEventListener('click', function() {
    // Update configs from form values
    const gameNameInputs = document.querySelectorAll('.game-name');
    const keywordsInputs = document.querySelectorAll('.keywords');
    const downloadPathInputs = document.querySelectorAll('.download-path');
    
    gameConfigs = [];
    
    for (let i = 0; i < gameNameInputs.length; i++) {
      // Ensure download paths end with a slash
      let downloadPath = downloadPathInputs[i].value.trim();
      if (downloadPath && !downloadPath.endsWith('/') && !downloadPath.endsWith('\\')) {
        downloadPath += '/';
      }
      
      gameConfigs.push({
        name: gameNameInputs[i].value.trim(),
        keywords: keywordsInputs[i].value.trim(),
        downloadPath: downloadPath
      });
    }
    
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