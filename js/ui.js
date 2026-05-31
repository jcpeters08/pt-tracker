// Self-contained UI helpers (toast + modals + a date formatter) extracted from
// index.html. These take explicit arguments — no app state — so call sites are
// unchanged. DOM-construction is used instead of innerHTML where practical.
import { escapeHtml } from "./util.js";

const $ = (s) => document.querySelector(s);

export function toast(msg, kind) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle("err", kind === "err");
  t.classList.toggle("ok", kind === "ok");
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

// "2026-05-18" -> "5/18"
export function shortDate(iso) {
  if (!iso) return "?";
  const parts = iso.split("-");
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

function heading(text) { const h = document.createElement("h4"); h.textContent = text; return h; }
function listOf(tag, items) {
  const el = document.createElement(tag);
  for (const s of items) { const li = document.createElement("li"); li.textContent = s; el.appendChild(li); }
  return el;
}

export function openHowto(meta) {
  const modal = $("#howto-modal");
  $("#ht-title").textContent = meta.name || meta.id || "";
  $("#ht-muscles").textContent = [meta.primary_muscle, ...(meta.secondary_muscles || [])].filter(Boolean).join(" · ");
  const body = $("#ht-body");
  body.replaceChildren();
  if (meta.instructions?.length) { body.append(heading("Steps"), listOf("ol", meta.instructions)); }
  if (meta.form_cues?.length) { body.append(heading("Form cues"), listOf("ul", meta.form_cues)); }
  if (meta.equipment?.length) {
    const p = document.createElement("p");
    p.style.margin = "4px 0";
    p.textContent = meta.equipment.join(", ");
    body.append(heading("Equipment"), p);
  }
  if (meta.info_url) {
    const a = document.createElement("a");
    a.className = "ht-link"; a.href = meta.info_url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Read full article on muscleandstrength.com →";
    body.append(a);
  }
  modal.classList.add("show");
  document.body.style.overflow = "hidden";
}

export function closeHowto() {
  $("#howto-modal").classList.remove("show");
  document.body.style.overflow = "";
}

export function openVideo(videoId, caption) {
  const host = $("#vm-iframe-host");
  // Build the iframe fresh each time so the prior video stops cleanly.
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  iframe.title = caption || "";
  iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
  iframe.setAttribute("allowfullscreen", "");
  host.replaceChildren(iframe);
  $("#vm-caption").textContent = caption || "";
  $("#video-modal").classList.add("show");
  document.body.style.overflow = "hidden";
}

export function closeVideo() {
  $("#video-modal").classList.remove("show");
  document.body.style.overflow = "";
  // Tearing down the iframe is what actually stops audio on iOS.
  setTimeout(() => { const h = $("#vm-iframe-host"); if (h) h.replaceChildren(); }, 250);
}

export function openLightbox(src, caption) {
  $("#lb-img").src = src;
  $("#lb-img").alt = caption || "";
  $("#lb-caption").textContent = caption || "";
  $("#lightbox").classList.add("show");
  document.body.style.overflow = "hidden";
}

export function closeLightbox() {
  $("#lightbox").classList.remove("show");
  document.body.style.overflow = "";
  setTimeout(() => { $("#lb-img").src = ""; }, 250);
}

// `escapeHtml` is re-exported for call sites that import UI helpers together.
export { escapeHtml };
