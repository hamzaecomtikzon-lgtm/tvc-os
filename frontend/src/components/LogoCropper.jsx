import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { contentBounds, imageSize, logoFromImage } from "../lib/setup.js";
import { Dialog, Ico } from "./ui.jsx";

const SHAPES = [["free", "Free", null], ["square", "Square", 1], ["wide", "Wide 3:1", 3], ["original", "Original", "img"]];
const MIN = 16; // smallest crop, in image pixels
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The largest box of `aspect` (w ÷ h) centered inside `r`. */
function fitAspect(r, aspect) {
  let w = r.w, h = w / aspect;
  if (h > r.h) { h = r.h; w = h * aspect; }
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/**
 * Crop a company logo. `img` is a loaded image; `onDone({ logo, w, h })` gets the cropped logo
 * (scaled to fit 400×400, transparency kept). Drag the box to move it, drag its edges or corners to
 * resize, or use a shape preset, "Trim empty edges" or "Use whole image".
 */
export default function LogoCropper({ img, onDone, onClose }) {
  const { w: iw, h: ih } = imageSize(img);
  const full = { x: 0, y: 0, w: iw, h: ih };
  const [crop, setCrop] = useState(() => contentBounds(img));
  const [shape, setShape] = useState("free");
  const [boxW, setBoxW] = useState(520);
  const stage = useRef(null);
  const drag = useRef(null);

  // Fit the image to the space the dialog has (it changes with the window).
  useLayoutEffect(() => {
    const el = stage.current?.parentElement;
    if (!el) return undefined;
    const measure = () => setBoxW(Math.max(220, Math.min(560, el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(boxW / iw, 340 / ih);
  const sw = Math.round(iw * scale), sh = Math.round(ih * scale);

  const aspectOf = (s) => { const a = SHAPES.find(([k]) => k === s)?.[2]; return a === "img" ? iw / ih : a; };
  const aspect = aspectOf(shape);
  const pickShape = (s) => {
    setShape(s);
    const a = aspectOf(s);
    if (a) setCrop((r) => fitAspect(s === "original" ? full : r.w < MIN * 2 || r.h < MIN * 2 ? full : r, a));
  };

  const onDown = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: crop };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale, dy = (e.clientY - d.y) / scale;
    const s = d.start;
    if (d.mode === "move") {
      setCrop({ ...s, x: clamp(s.x + dx, 0, iw - s.w), y: clamp(s.y + dy, 0, ih - s.h) });
      return;
    }
    let { x, y } = s;
    let x2 = s.x + s.w, y2 = s.y + s.h;
    if (d.mode.includes("w")) x = clamp(s.x + dx, 0, x2 - MIN);
    if (d.mode.includes("e")) x2 = clamp(x2 + dx, x + MIN, iw);
    if (d.mode.includes("n")) y = clamp(s.y + dy, 0, y2 - MIN);
    if (d.mode.includes("s")) y2 = clamp(y2 + dy, y + MIN, ih);
    let r = { x, y, w: x2 - x, h: y2 - y };
    if (aspect) {
      // Keep the shape: size from the dragged width, anchored at the opposite corner, shrunk to stay inside the image.
      let w = r.w, h = w / aspect;
      const ax = d.mode.includes("w") ? s.x + s.w : s.x, ay = d.mode.includes("n") ? s.y + s.h : s.y;
      const maxW = d.mode.includes("w") ? ax : iw - ax, maxH = d.mode.includes("n") ? ay : ih - ay;
      if (w > maxW) { w = maxW; h = w / aspect; }
      if (h > maxH) { h = maxH; w = h * aspect; }
      w = Math.max(w, MIN); h = w / aspect;
      r = { x: d.mode.includes("w") ? ax - w : ax, y: d.mode.includes("n") ? ay - h : ay, w, h };
    }
    setCrop(r);
  };
  const onUp = () => { drag.current = null; };

  // Arrow keys nudge the box (Shift = 10px), for people who'd rather not drag.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.key.startsWith("Arrow") || /input|select|textarea/i.test(document.activeElement?.tagName || "")) return;
      e.preventDefault();
      const n = (e.shiftKey ? 10 : 1) / scale;
      setCrop((r) => ({ ...r, x: clamp(r.x + (e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0), 0, iw - r.w), y: clamp(r.y + (e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0), 0, ih - r.h) }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scale, iw, ih]);

  const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) });
  const out = (() => { const k = Math.min(1, 400 / Math.max(crop.w, crop.h)); return `${Math.round(crop.w * k)} × ${Math.round(crop.h * k)} px`; })();
  const box = { left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale };

  return (
    <Dialog
      title="Crop your logo"
      onClose={onClose}
      actions={<>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" onClick={() => onDone(logoFromImage(img, round(crop)))}><Ico name="check" />Use this crop</button>
      </>}
    >
      <div className="crop">
        <div className="crop-shapes" role="group" aria-label="Crop shape">
          {SHAPES.map(([k, l]) => <button key={k} type="button" className={"chip" + (shape === k ? " on" : "")} onClick={() => pickShape(k)}>{l}</button>)}
        </div>
        <div className="crop-wrap">
          <div ref={stage} className="crop-stage" style={{ width: sw, height: sh }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <img src={img.src} alt="" draggable={false} style={{ width: sw, height: sh }} />
            <div className="crop-box" style={box} onPointerDown={onDown("move")} aria-label="Crop area: drag to move">
              <i className="crop-grid" />
              {HANDLES.filter((h) => !aspect || h.length === 2).map((h) => <span key={h} className={"crop-h " + h} onPointerDown={onDown(h)} />)}
            </div>
          </div>
        </div>
        <div className="crop-tools">
          <button className="btn sm" type="button" onClick={() => { setShape("free"); setCrop(contentBounds(img)); }}><Ico name="spark" />Trim empty edges</button>
          <button className="btn sm ghost" type="button" onClick={() => { setShape("free"); setCrop(full); }}>Use whole image</button>
          <span className="muted">Saved as {out}. Drag the box or its edges; arrow keys nudge it.</span>
        </div>
      </div>
    </Dialog>
  );
}
