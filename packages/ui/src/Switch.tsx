type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
};

// A proper toggle switch reads more clearly than a bare checkbox for boolean settings (cloud AI,
// notifications, telemetry) and gives a satisfying, obviously-"on/off" click target.
export const Switch = ({ checked, onChange, label, description, disabled = false }: SwitchProps) => {
  const track = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        checked ? 'bg-sky-500' : 'bg-slate-700'
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out',
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        ].join(' ')}
      />
    </button>
  );

  if (!label) return track;

  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-slate-950/80 px-4 py-3">
      <div>
        <p className="text-sm text-slate-200">{label}</p>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      {track}
    </label>
  );
};
