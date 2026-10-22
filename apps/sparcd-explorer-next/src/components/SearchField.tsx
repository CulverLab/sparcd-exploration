import { useRef } from 'react';

/**
 * A search box with its own "×", shown whenever it has text: the browser's
 * shows only on hover. Esc clears the text first; on an empty box it does
 * what it did before, such as closing the popover around it.
 */
export function SearchField({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="searchfield">
      <input
        ref={input}
        id={id}
        className="field"
        type="search"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !value) return;
          e.preventDefault();
          e.stopPropagation();
          onChange('');
        }}
      />
      {value && (
        <button
          type="button"
          className="searchclear"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
