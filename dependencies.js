// Function to load a script dynamically and return a Promise
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve; // Resolve the promise when the script loads
    script.onerror = reject; // Reject if there's an error loading
    document.head.appendChild(script); // Add the script to the page
  });
}

// --- Run these lines in the console FIRST ---
console.log("Loading TensorFlow.js core...");
loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js')
  .then(() => {
    console.log("TensorFlow.js core LOADED.");
    console.log("Loading Coco-SSD model script...");
    return loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2');
  })
  .then(() => {
    console.log("Coco-SSD model script LOADED.");
    console.log("Libraries loaded successfully. You can now paste the main XcloudCheat script code.");
    // IMPORTANT: Now you would paste the *rest* of the XcloudCheat script code
    // (everything *below* the // ==/UserScript== line) into the console and run it.
  })
  .catch(error => {
    console.error("Failed to load required libraries:", error);
    alert("Error loading dependency scripts. Check the console.");
  });

// --- DO NOT PASTE THE MAIN SCRIPT UNTIL YOU SEE "Libraries loaded successfully..." ---
