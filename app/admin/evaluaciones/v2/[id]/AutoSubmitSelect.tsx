"use client";

import { useState } from "react";

type Option = {
  value: string;
  label: string;
};

export function AutoSubmitSelect({
  name,
  defaultValue,
  disabled,
  options,
}: {
  name: string;
  defaultValue: string;
  disabled?: boolean;
  options: Option[];
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <select
      name={name}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setValue(nextValue);
        event.currentTarget.form?.requestSubmit();
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
