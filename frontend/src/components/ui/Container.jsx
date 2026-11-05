// Max width 1100px, centered, 24px side padding.
export function Container({ className = '', children, ...rest }) {
  return (
    <div className={`mx-auto w-full max-w-[1100px] px-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}
