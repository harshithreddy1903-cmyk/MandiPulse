import { useEffect, useRef } from 'react';

export default function Modal({ title, onClose, children }) {
  const container = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = container.current;
    const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
    const focusables = () => [...root.querySelectorAll(selector)].filter(node => node.getClientRects().length);
    (root.querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || focusables()[0] || root).focus();
    function onKey(event) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) { event.preventDefault(); root.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div className="backdrop" ref={container} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</div>;
}
