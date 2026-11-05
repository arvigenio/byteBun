import { useCallback, useEffect, useRef } from 'react';
import { useScrollLock } from './useScrollLock.js';

// Drives a native <dialog> from an `isOpen` flag.
// The browser gives us: Escape to close, inert background (focus stays inside) and top-layer
// stacking. This hook adds: backdrop click to close, page scroll lock, and focus returning to
// whatever opened the dialog.
//
// `onClose` must update the state that `isOpen` comes from; it runs for every way of closing.
// Spread `dialogProps` onto the <dialog>.
export function useModalDialog(isOpen, onClose) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  useScrollLock(isOpen);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      triggerRef.current = document.activeElement; // still the button that opened it
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fires after the dialog has closed, whatever closed it (Escape, button, backdrop).
  const handleClose = useCallback(() => {
    onClose();
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && document.contains(trigger)) trigger.focus();
  }, [onClose]);

  // A click whose target is the <dialog> itself landed on the backdrop, not the content.
  const handleClick = useCallback((e) => {
    if (e.target === dialogRef.current) dialogRef.current.close();
  }, []);

  return {
    dialogProps: {
      ref: dialogRef,
      onClose: handleClose,
      onClick: handleClick,
      'data-lenis-prevent': true, // let the dialog's own content scroll natively
    },
  };
}
