const README_WAIT_TIMEOUT_MS = 15_000;

const README_SELECTORS = [
  "#readme article.markdown-body",
  "#readme .markdown-body",
  '[data-testid="readme"] article.markdown-body',
  '[data-testid="readme"].markdown-body',
  '[data-testid="readme"] .markdown-body',
  "main #readme",
  "main article.markdown-body"
];

function readTrendingProjects() {
  return Array.from(document.querySelectorAll("article.Box-row")).map((article, index) => {
    const link = article.querySelector('h2 a[href*="/"]');
    return {
      rank: index + 1,
      name: link?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      url: link ? new URL(link.getAttribute("href"), location.origin).href : ""
    };
  }).filter((project) => project.url);
}

function findReadmeContainer() {
  for (const selector of README_SELECTORS) {
    const readme = document.querySelector(selector);
    if (readme) return { readme, selector };
  }
  return null;
}

function findRenderedReadme() {
  const match = findReadmeContainer();
  if (!match) return null;

  const text = match.readme.textContent?.trim() ?? "";
  const hasRichContent = Boolean(match.readme.querySelector("img, picture, video, table, pre, blockquote, ul, ol"));
  if (!text && !hasRichContent) return null;

  return {
    html: match.readme.innerHTML,
    text,
    url: location.href,
    selector: match.selector,
    pageTitle: document.title
  };
}

function readDiagnosticText() {
  const candidates = [
    document.querySelector("main"),
    document.querySelector("#js-flash-container"),
    document.querySelector(".blankslate")
  ];
  return candidates
    .map((element) => element?.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 8_000)
    .toLowerCase();
}

function diagnoseReadmeFailure() {
  const title = document.title.toLowerCase();
  const text = readDiagnosticText();
  const pathname = location.pathname.toLowerCase();
  const hasRepositoryShell = Boolean(
    document.querySelector("#repository-container-header")
      || document.querySelector('[data-testid="repository-container-header"]')
      || document.querySelector('meta[name="octolytics-dimension-repository_id"]')
  );

  if (pathname === "/login" || document.querySelector('form[action="/session"]')) {
    return "github_auth_required";
  }
  if (
    title.includes("rate limit")
      || text.includes("rate limit exceeded")
      || text.includes("secondary rate limit")
      || text.includes("you have exceeded a rate limit")
  ) {
    return "github_rate_limited";
  }
  if (
    title.includes("page not found")
      || text.includes("this repository is currently unavailable")
      || text.includes("repository not found")
  ) {
    return "repository_unavailable";
  }
  if (document.readyState !== "complete" || !hasRepositoryShell || document.querySelector("#readme .octicon-spinner")) {
    return "readme_load_timeout";
  }
  if (findReadmeContainer()) return "readme_empty";
  return "readme_not_found";
}

function waitForRenderedReadme(timeoutMs = README_WAIT_TIMEOUT_MS) {
  const immediateResult = findRenderedReadme();
  if (immediateResult) return Promise.resolve(immediateResult);

  return new Promise((resolve) => {
    let settled = false;
    let observer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearTimeout(timeoutId);
      resolve(result);
    };

    const check = () => {
      const result = findRenderedReadme();
      if (result) finish(result);
    };

    const timeoutId = setTimeout(() => {
      finish({
        html: "",
        text: "",
        url: location.href,
        errorCode: diagnoseReadmeFailure(),
        pageTitle: document.title
      });
    }, timeoutMs);

    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    check();
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "READ_TRENDING") {
    sendResponse({ projects: readTrendingProjects(), url: location.href });
    return;
  }
  if (message?.type === "READ_README") {
    waitForRenderedReadme()
      .then(sendResponse)
      .catch((error) => sendResponse({
        html: "",
        text: "",
        url: location.href,
        errorCode: error.message || "readme_unavailable",
        pageTitle: document.title
      }));
    return true;
  }
});

chrome.runtime.sendMessage({ type: "CONTENT_READY", url: location.href });
