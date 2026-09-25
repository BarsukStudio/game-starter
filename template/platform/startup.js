// Copied into the consumer: only local readiness controls the first screen.
// The game owns error presentation; purchases and ads run independently.
export async function startGame(loadGame, revealScreen, onLoadError) {
  try {
    await loadGame();
  } catch (error) {
    onLoadError(error);
  }
  // Wait for a foreground frame, without a Billing or advertising timeout.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    await revealScreen();
  } catch (error) {
    console.warn('SplashScreen.hide failed', error);
  }
}
