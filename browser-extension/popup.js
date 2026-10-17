/**
 * Astra Studio Importer — Extension Popup Script
 */

const DEFAULT_URL = "http://localhost:3000";

document.addEventListener("DOMContentLoaded", () => {
  const videoDetectedSection = document.getElementById("video-detected");
  const noVideoSection = document.getElementById("no-video");
  const videoThumb = document.getElementById("video-thumb");
  const videoTitle = document.getElementById("video-title");
  const videoIdDisplay = document.getElementById("video-id-display");
  const sendBtn = document.getElementById("send-btn");
  const astraUrlInput = document.getElementById("astra-url");
  const saveUrlBtn = document.getElementById("save-url-btn");
  const saveFeedback = document.getElementById("save-feedback");
  const openStudioLink = document.getElementById("open-studio-link");

  let currentVideoId = null;
  let currentVideoTitle = "YouTube Video";
  let currentVideoUrl = null;

  // 1. Load configured Astra Studio URL
  chrome.storage.sync.get({ astraUrl: DEFAULT_URL }, (data) => {
    const url = data.astraUrl || DEFAULT_URL;
    astraUrlInput.value = url;
    openStudioLink.href = url;
  });

  // 2. Save Astra Studio URL configuration
  saveUrlBtn.addEventListener("click", () => {
    let newUrl = astraUrlInput.value.trim();
    if (!newUrl) newUrl = DEFAULT_URL;

    // Validate URL format
    try {
      new URL(newUrl);
    } catch {
      saveFeedback.textContent = "Please enter a valid URL (e.g. http://localhost:3000)";
      saveFeedback.className = "feedback-text";
      saveFeedback.style.color = "#f87171";
      return;
    }

    chrome.storage.sync.set({ astraUrl: newUrl }, () => {
      saveFeedback.textContent = "Saved workspace URL!";
      saveFeedback.className = "feedback-text success";
      openStudioLink.href = newUrl;
      setTimeout(() => {
        saveFeedback.textContent = "";
      }, 2500);
    });
  });

  // 3. Inspect active tab to detect YouTube video
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const tab = tabs[0];
    if (!tab.url) return;

    try {
      const parsed = new URL(tab.url);
      const isYouTube =
        parsed.hostname === "www.youtube.com" ||
        parsed.hostname === "youtube.com" ||
        parsed.hostname === "m.youtube.com";

      if (isYouTube) {
        let v = parsed.searchParams.get("v");
        if (!v && parsed.pathname.startsWith("/shorts/")) {
          const match = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
          if (match) v = match[1];
        }

        if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
          currentVideoId = v;
          currentVideoUrl = `https://www.youtube.com/watch?v=${v}`;
          currentVideoTitle = (tab.title || "YouTube Video").replace(/\s*-\s*YouTube\s*$/i, "").trim();

          // Display video detected section
          videoThumb.src = `https://img.youtube.com/vi/${v}/hqdefault.jpg`;
          videoTitle.textContent = currentVideoTitle;
          videoIdDisplay.textContent = `ID: ${v}`;

          videoDetectedSection.classList.remove("hidden");
          noVideoSection.classList.add("hidden");
          return;
        }
      }
    } catch (e) {
      console.warn("Tab URL parsing error:", e);
    }

    // Default: no video detected
    videoDetectedSection.classList.add("hidden");
    noVideoSection.classList.remove("hidden");
  });

  // 4. Send to Astra Studio click handler
  sendBtn.addEventListener("click", () => {
    if (!currentVideoId) return;

    chrome.storage.sync.get({ astraUrl: DEFAULT_URL }, (data) => {
      const baseUrl = (data.astraUrl || DEFAULT_URL).replace(/\/+$/, "");
      const target = new URL(`${baseUrl}/import`);
      target.searchParams.set("url", currentVideoUrl || `https://www.youtube.com/watch?v=${currentVideoId}`);
      target.searchParams.set("id", currentVideoId);
      target.searchParams.set("title", currentVideoTitle);

      chrome.tabs.create({ url: target.toString() });
    });
  });
});
