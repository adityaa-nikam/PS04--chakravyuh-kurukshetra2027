/**
 * Astra Studio — YouTube One-Click Video Importer
 * Content Script (Chrome Manifest V3)
 */

(function () {
  "use strict";

  const BUTTON_ID = "astra-yt-btn";
  const DEFAULT_ASTRA_URL = "http://localhost:3000";
  let lastInjectedVideoId = null;
  let isInjecting = false;

  /**
   * Safely extract the YouTube video ID from the current page
   */
  function extractVideoId() {
    try {
      const url = new URL(window.location.href);

      // Standard watch page: /watch?v=VIDEO_ID
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }

      // YouTube Shorts: /shorts/VIDEO_ID
      const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch && shortsMatch[1]) {
        return shortsMatch[1];
      }

      // Fallback from DOM element attribute
      const watchFlexy = document.querySelector("ytd-watch-flexy");
      if (watchFlexy && watchFlexy.getAttribute("video-id")) {
        const domId = watchFlexy.getAttribute("video-id");
        if (/^[a-zA-Z0-9_-]{11}$/.test(domId)) {
          return domId;
        }
      }
    } catch (e) {
      console.warn("[Astra] Video ID extraction error:", e);
    }
    return null;
  }

  /**
   * Safely extract the video title using safe DOM properties (no innerHTML)
   */
  function extractVideoTitle() {
    try {
      // 1. YouTube primary formatted title element
      const titleElem =
        document.querySelector("#title h1 yt-formatted-string") ||
        document.querySelector("ytd-watch-metadata #title h1") ||
        document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
        document.querySelector("h1.title yt-formatted-string");

      if (titleElem && titleElem.textContent && titleElem.textContent.trim()) {
        return titleElem.textContent.trim();
      }

      // 2. OpenGraph / Meta tag fallback
      const metaTitle =
        document.querySelector('meta[name="title"]') ||
        document.querySelector('meta[property="og:title"]');
      if (metaTitle && metaTitle.getAttribute("content")) {
        return metaTitle.getAttribute("content").trim();
      }

      // 3. Document Title fallback
      if (document.title) {
        return document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
      }
    } catch (e) {
      console.warn("[Astra] Title extraction error:", e);
    }
    return "YouTube Video";
  }

  /**
   * Construct canonical URL
   */
  function getCanonicalUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  /**
   * Get configured Astra Studio base URL from chrome.storage
   */
  function getAstraStudioUrl(callback) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get({ astraUrl: DEFAULT_ASTRA_URL }, function (items) {
          callback(items.astraUrl || DEFAULT_ASTRA_URL);
        });
        return;
      }
    } catch (e) {
      console.warn("[Astra] Storage error, using fallback URL:", e);
    }
    callback(DEFAULT_ASTRA_URL);
  }

  /**
   * Create the "✦ Create with Astra" button using safe DOM APIs
   */
  function createAstraButton(videoId) {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.dataset.videoId = videoId;
    btn.setAttribute("aria-label", "Import this video into Astra Studio");
    btn.setAttribute("title", "✦ Send video to Astra Studio to generate 9:16 vertical reels");

    // Star Icon container
    const iconSpan = document.createElement("span");
    iconSpan.className = "astra-icon";

    // SVG Four-Pointed Astra Star
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z"
    );
    svg.appendChild(path);
    iconSpan.appendChild(svg);

    // Label text
    const labelSpan = document.createElement("span");
    labelSpan.className = "astra-label";
    labelSpan.textContent = "Create with Astra";

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);

    // Click handler
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const currentVideoId = extractVideoId();
      if (!currentVideoId) {
        alert("Astra Studio: Could not detect active YouTube video ID.");
        return;
      }

      const title = extractVideoTitle();
      const canonicalUrl = getCanonicalUrl(currentVideoId);

      // Loading state animation on button
      btn.classList.add("astra-loading");
      labelSpan.textContent = "Opening Astra...";

      getAstraStudioUrl(function (baseUrl) {
        const cleanBase = baseUrl.replace(/\/+$/, "");
        const importUrl = new URL(`${cleanBase}/`);
        importUrl.searchParams.set("mode", "youtube");
        importUrl.searchParams.set("url", canonicalUrl);
        importUrl.searchParams.set("id", currentVideoId);
        importUrl.searchParams.set("title", title);

        // Open in new tab
        window.open(importUrl.toString(), "_blank");

        setTimeout(() => {
          btn.classList.remove("astra-loading");
          labelSpan.textContent = "Create with Astra";
        }, 1200);
      });
    });

    return btn;
  }

  /**
   * Find the optimal injection container in YouTube's watch interface
   */
  function findTargetContainer() {
    // 1. YouTube top action buttons (where Like / Share live)
    const selectors = [
      "#top-level-buttons-computed",
      "ytd-watch-metadata #top-level-buttons-computed",
      "#actions-inner #top-level-buttons-computed",
      "ytd-menu-renderer.ytd-watch-metadata",
      "#actions #top-level-buttons",
      "#owner",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.isConnected) {
        return { container: el, isFloating: false };
      }
    }

    // Fallback: floating pill on bottom right
    return { container: document.body, isFloating: true };
  }

  /**
   * Main injection logic with duplicate prevention & SPA route updates
   */
  function injectButton() {
    if (isInjecting) return;
    isInjecting = true;

    try {
      const videoId = extractVideoId();
      if (!videoId) {
        // Not on a video page - remove any existing button
        const existing = document.getElementById(BUTTON_ID);
        if (existing) existing.remove();
        lastInjectedVideoId = null;
        return;
      }

      const existingBtn = document.getElementById(BUTTON_ID);

      // If button already exists and matches current video, do nothing
      if (existingBtn && existingBtn.dataset.videoId === videoId && existingBtn.isConnected) {
        return;
      }

      // If video changed, remove previous button
      if (existingBtn) {
        existingBtn.remove();
      }

      const target = findTargetContainer();
      if (!target.container) return;

      const button = createAstraButton(videoId);
      if (target.isFloating) {
        button.classList.add("astra-floating");
      }

      // Inject into YouTube button bar
      target.container.appendChild(button);
      lastInjectedVideoId = videoId;
    } catch (err) {
      console.warn("[Astra] Injection error:", err);
    } finally {
      isInjecting = false;
    }
  }

  // --------------------------------------------------------------------------
  // YouTube SPA Lifecycle Listeners
  // --------------------------------------------------------------------------

  // Initial attempt
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectButton);
  } else {
    injectButton();
  }

  // YouTube navigation events
  window.addEventListener("yt-navigate-finish", () => {
    setTimeout(injectButton, 350);
  });
  window.addEventListener("yt-page-data-updated", () => {
    setTimeout(injectButton, 350);
  });
  window.addEventListener("spfdone", () => {
    setTimeout(injectButton, 350);
  });
  window.addEventListener("popstate", () => {
    setTimeout(injectButton, 350);
  });

  // Polling safety fallback for dynamic layout shifts and related video clicks
  setInterval(() => {
    const currentId = extractVideoId();
    if (currentId && currentId !== lastInjectedVideoId) {
      injectButton();
    } else if (currentId && !document.getElementById(BUTTON_ID)) {
      injectButton();
    }
  }, 1000);
})();
