(function initializeTelegramMiniApp() {
  const webApp = window.Telegram?.WebApp;

  if (!webApp) {
    return;
  }

  webApp.ready();
  webApp.expand();
})();
