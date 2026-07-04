const CATEGORY_LABEL = { single: "新曲", live: "ライブ", news: "ニュース" };
const STORAGE_KEY = "enka-news-cache-v1";
const PAGE_SIZE = 100;
const MAX_TOTAL = 200;
const PULL_THRESHOLD = 64;

const state = {
  allItems: [],
  updatedAt: null,
  stale: false,
  filter: null, // null = すべて、それ以外は artist 名
  visibleCount: PAGE_SIZE,
};

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

function currentFilteredItems() {
  if (!state.filter) return state.allItems;
  return state.allItems.filter((item) => item.artist === state.filter);
}

function renderUpdatedBar() {
  const bar = document.getElementById("updated-bar");
  if (!state.updatedAt) {
    bar.textContent = "情報を準備しています";
    bar.classList.remove("stale");
    return;
  }
  bar.textContent = `最終更新：${formatUpdatedAt(state.updatedAt)}${state.stale ? "（前回の情報）" : ""}`;
  bar.classList.toggle("stale", !!state.stale);
}

function renderFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.toggle("active", state.filter === btn.dataset.artist);
  });
}

function renderSectionLabel() {
  const label = document.getElementById("section-label-text");
  const resetBtn = document.getElementById("reset-filter");
  label.textContent = state.filter ? `${state.filter}の最新情報` : "新着";
  resetBtn.hidden = !state.filter;
}

function renderFeed() {
  const feed = document.getElementById("feed");
  const loadMoreWrap = document.getElementById("load-more-wrap");
  const filtered = currentFilteredItems();

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        まだ表示できる情報がありません。<br>
        少し時間をおいてから、もう一度開いてみてください。
      </div>`;
    loadMoreWrap.hidden = true;
    return;
  }

  const visible = filtered.slice(0, state.visibleCount);

  feed.innerHTML = visible
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

  loadMoreWrap.hidden = filtered.length <= state.visibleCount;
}

function renderAll() {
  renderUpdatedBar();
  renderFilterButtons();
  renderSectionLabel();
  renderFeed();
}

function setFilter(artist) {
  state.filter = state.filter === artist ? null : artist;
  state.visibleCount = PAGE_SIZE;
  renderAll();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function loadMore() {
  state.visibleCount = Math.min(state.visibleCount + PAGE_SIZE, MAX_TOTAL);
  renderFeed();
}

async function loadFeed() {
  // Try the network first — freshest data when available.
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      applyData(data, { stale: false });
      return;
    }
  } catch (err) {
    // Network unavailable — fall through to cached data below.
  }

  // Fall back to whatever we last saw, so the screen is never blank or an error.
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    try {
      applyData(JSON.parse(cached), { stale: true });
      return;
    } catch (err) {
      // Ignore corrupt cache and fall through to the empty state.
    }
  }

  applyData(null, {});
}

function applyData(data, { stale }) {
  state.allItems = (data && Array.isArray(data.items)) ? data.items.slice(0, MAX_TOTAL) : [];
  state.updatedAt = data ? data.updatedAt : null;
  state.stale = !!stale;
  renderAll();
}

// --- 歌手フィルターボタン ---
document.getElementById("artist-filters").addEventListener("click", (event) => {
  const btn = event.target.closest(".filter-btn");
  if (btn) setFilter(btn.dataset.artist);
});
document.getElementById("reset-filter").addEventListener("click", () => setFilter(null));
document.getElementById("load-more-btn").addEventListener("click", loadMore);

// --- 下に引っ張って更新（プルリフレッシュ） ---
(function setupPullToRefresh() {
  const indicator = document.getElementById("pull-indicator");
  const label = indicator.querySelector(".pull-label");
  let startY = null;
  let pulling = false;
  let refreshing = false;

  window.addEventListener(
    "touchstart",
    (event) => {
      if (window.scrollY === 0 && !refreshing) {
        startY = event.touches[0].clientY;
        pulling = true;
      } else {
        startY = null;
        pulling = false;
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (!pulling || startY === null) return;
      const delta = event.touches[0].clientY - startY;
      if (delta <= 0) return;
      const height = Math.min(delta * 0.6, PULL_THRESHOLD + 20);
      indicator.style.height = `${height}px`;
      label.textContent = height >= PULL_THRESHOLD ? "離すと更新します" : "引っ張って更新";
    },
    { passive: true }
  );

  window.addEventListener("touchend", async () => {
    if (!pulling) return;
    const height = parseFloat(indicator.style.height || "0");
    pulling = false;
    startY = null;

    if (height >= PULL_THRESHOLD && !refreshing) {
      refreshing = true;
      indicator.classList.add("spinning");
      indicator.style.height = "48px";
      label.textContent = "更新しています…";
      await loadFeed();
      indicator.classList.remove("spinning");
      indicator.style.height = "0px";
      refreshing = false;
    } else {
      indicator.style.height = "0px";
    }
  });
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Offline caching is a bonus, not a requirement — ignore failures silently.
    });
  });

  // 新しいバージョンが公開されたら、ホーム画面アプリでも自動で最新版に切り替える
  // （毎回手動でアプリを閉じ直してもらう必要をなくすため）。
  let reloadedOnce = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedOnce) return;
    reloadedOnce = true;
    window.location.reload();
  });
}

loadFeed();
