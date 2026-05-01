let lastCaptureTime = 0;
let capturePromise = null;

export async function safeCaptureVisibleTab() {
  if (capturePromise) {
    return capturePromise;
  }
  
  const executeCapture = async () => {
    try {
      const now = Date.now();
      if (now - lastCaptureTime < 600) {
        await new Promise((r) => setTimeout(r, 600 - (now - lastCaptureTime)));
      }
      lastCaptureTime = Date.now();
      return await chrome.tabs.captureVisibleTab(null, { format: "png" });
    } finally {
      capturePromise = null;
    }
  };
  
  capturePromise = executeCapture();
  return capturePromise;
}
