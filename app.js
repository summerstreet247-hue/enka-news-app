const CATEGORY_LABEL = { single: "新曲", live: "ライブ", news: "ニュース" };
const STORAGE_KEY = "enka-news-cache-v1";

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatUpdatedAt(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `今日 ${time}` : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

function renderFeed(data, { stale } = {}) {
  const feed = document.getElementById("feed");
  const bar = document.getElementById("updated-bar");

  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    bar.textContent = "情報を準備しています";
    feed.innerHTML = `
      <div class="empty-state">
        まだ表示できる情報がありません。<br>
        少し時間をおいてから、もう一度開いてみてください。
      </div>`;
    return;
  }

  bar.textContent = `最終更新：${formatUpdatedAt(data.updatedAt)}${stale ? "（前回の情報）" : ""}`;
  bar.classList.toggle("stale", !!stale);

  feed.innerHTML = data.items
    .map((item) => {
      const label = CATEGORY_LABEL[item.category] || "ニュース";
      const cls = CATEGORY_LABEL[item.category] ? item.category : "news";
      return `
        <a class="card" href="${item.url}" target="_blank" rel="noopener">
          <div class="card-top">
            <span class="tag ${cls}">${label}</span>
            <span class="artist">${item.artist}</span>
          </div>
          <p class="headline">${item.headline}</p>
          <p class="card-date">${formatDate(item.date)}</p>
        </a>`;
    })
    .join("");
}

async function loadFeed() {
  // Try the network first — freshest data when available.
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      renderFeed(data);
      return;
    }
  } catch (err) {
    // Network unavailable — fall through to cached data below.
  }

  // Fall back to whatever we last saw, so the screen is never blank or an error.
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    try {
      renderFeed(JSON.parse(cached), { stale: true });
      return;
    } catch (err) {
      // Ignore corrupt cache and fall through to the empty state.
    }
  }

  renderFeed(null);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Offline caching is a bonus, not a requirement — ignore failures silently.
    });
  });
}

loadFeed();
