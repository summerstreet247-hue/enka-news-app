const CATEGORY_LABEL = { single: "新曲", live: "ライブ", news: "ニュース", youtube: "YouTube" };
const STORAGE_KEY = "enka-news-cache-v1";
const PAGE_SIZE = 100;
const MAX_TOTAL = 200;
const PULL_THRESHOLD = 64;

const state = {
  allItems: [],
  updatedAt: null,
  stale: false,
  filter: null, // null = すべて、それ以外は artist 名
  tvOnly: false, // true = テレビ出演情報だけに絞る
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
  let items = state.allItems;
  if (state.filter) items = items.filter((item) => item.artist === state.filter);
  if (state.tvOnly) items = items.filter((item) => item.tv);
  return items;
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
  document.querySelectorAll(".filter-btn[data-artist]").forEach((btn) => {
    btn.classList.toggle("active", state.filter === btn.dataset.artist);
  });
  document.getElementById("tv-filter-btn").classList.toggle("active", state.tvOnly);
}

function renderSectionLabel() {
  const label = document.getElementById("section-label-text");
  const resetBtn = document.getElementById("reset-filter");
  let text = "新着";
  if (state.filter && state.tvOnly) {
    text = `${state.filter}のテレビ出演情報`;
  } else if (state.tvOnly) {
    text = "テレビ出演情報";
  } else if (state.filter) {
    text = `${state.filter}の最新情報`;
  }
  label.textContent = text;
  resetBtn.hidden = !state.filter && !state.tvOnly;
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
      const image = item.image
        ? `<img class="card-image" src="${item.image}" alt="" loading="lazy" onerror="this.remove()">`
        : "";
      const videoAttr = item.videoId ? ` data-video-id="${item.videoId}"` : "";
      return `
        <a class="card" href="${item.url}" target="_blank" rel="noopener"${videoAttr}>
          <div class="card-top">
            <span class="tag ${cls}">${label}</span>
            <span class="artist">${item.artist}</span>
          </div>
          <p class="headline">${item.headline}</p>
          ${image}
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

function toggleTvFilter() {
  state.tvOnly = !state.tvOnly;
  state.visibleCount = PAGE_SIZE;
  renderAll();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function resetFilters() {
  state.filter = null;
  state.tvOnly = false;
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

// --- YouTube動画はアプリ内で埋め込み再生する ---
const videoModal = document.getElementById("video-modal");
const videoFrameWrap = document.getElementById("video-frame-wrap");

function openVideoModal(videoId) {
  videoFrameWrap.innerHTML = `<iframe
    src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1"
    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen
    frameborder="0"></iframe>`;
  videoModal.hidden = false;
}

function closeVideoModal() {
  videoModal.hidden = true;
  videoFrameWrap.innerHTML = ""; // 再生を止めるため、iframeごと消す
}

document.getElementById("feed").addEventListener("click", (event) => {
  const card = event.target.closest(".card[data-video-id]");
  if (!card) return;
  event.preventDefault();
  openVideoModal(card.dataset.videoId);
});
document.getElementById("video-modal-close").addEventListener("click", closeVideoModal);
videoModal.addEventListener("click", (event) => {
  if (event.target === videoModal) closeVideoModal();
});

// --- 歌手フィルターボタン ---
document.getElementById("artist-filters").addEventListener("click", (event) => {
  const btn = event.target.closest(".filter-btn");
  if (btn) setFilter(btn.dataset.artist);
});
document.getElementById("reset-filter").addEventListener("click", resetFilters);
document.getElementById("tv-filter-btn").addEventListener("click", toggleTvFilter);
document.getElementById("load-more-btn").addEventListener("click", loadMore);

// --- 更新中の見た目（プルリフレッシュ・最終更新タップ、共通） ---
const pullIndicator = document.getElementById("pull-indicator");
const pullLabel = pullIndicator.querySelector(".pull-label");
let refreshing = false;

async function refreshWithFeedback() {
  if (refreshing) return;
  refreshing = true;
  pullIndicator.classList.add("spinning");
  pullIndicator.style.height = "48px";
  pullLabel.textContent = "更新しています…";
  await loadFeed();
  pullIndicator.classList.remove("spinning");
  pullIndicator.style.height = "0px";
  refreshing = false;
}

// --- 「最終更新」をタップしても再取得できるようにする ---
document.getElementById("updated-bar").addEventListener("click", refreshWithFeedback);

// --- 下に引っ張って更新（プルリフレッシュ） ---
(function setupPullToRefresh() {
  let startY = null;
  let pulling = false;

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
      pullIndicator.style.height = `${height}px`;
      pullLabel.textContent = height >= PULL_THRESHOLD ? "離すと更新します" : "引っ張って更新";
    },
    { passive: true }
  );

  window.addEventListener("touchend", async () => {
    if (!pulling) return;
    const height = parseFloat(pullIndicator.style.height || "0");
    pulling = false;
    startY = null;

    if (height >= PULL_THRESHOLD) {
      await refreshWithFeedback();
    } else {
      pullIndicator.style.height = "0px";
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
