console.log("CONTENT SCRIPT DEFINITELY LOADED!");
//alert("Content script is working!");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in content script:", request);

  if (request.action === "getPageContext") {
    // Return basic info for now
    sendResponse({
      success: true,
      title: document.title,
      url: window.location.href,
      selectedText: window.getSelection().toString(),
      mainContent: "TEST: Content script is working",
      metadata: { isGoogleDocs: true },
    });
    return true;
  }
});
