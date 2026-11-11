import { useEffect, useRef } from "react";

/**
 * Reusable modal built on <dialog>: focus trap, Esc to close, backdrop click to close.
 * `footer` renders in a sticky action row.
 */
export default function Modal({ title, subtitle, onClose, children, footer, size = "md" }) {
  const ref = useRef(null);

  useEffect(() => { 
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d && d.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={"modal modal-" + size}
      aria-labelledby="modal-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="modal-frame">
        <header className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}
