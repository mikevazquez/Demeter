"use client";

import { useState } from "react";

export function AutoSubmitInput({
  name,
  defaultValue,
  type = "text",
  min,
  max,
  step,
  className,
  placeholder,
  disabled,
  ariaLabel,
}: {
  name: string;
  defaultValue: string | number;
  type?: "text" | "number";
  min?: number;
  max?: number;
  step?: number | string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [value, setValue] = useState(String(defaultValue ?? ""));

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      max={max}
      min={min}
      name={name}
      onBlur={(event) => event.currentTarget.form?.requestSubmit()}
      onChange={(event) => setValue(event.currentTarget.value)}
      placeholder={placeholder}
      step={step}
      type={type}
      value={value}
    />
  );
}
