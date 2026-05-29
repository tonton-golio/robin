"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";

interface BriefEntry {
  slug: string;
  title: string;
}

interface Props {
  briefs: BriefEntry[];
  selected: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
}

export default function BriefPicker({ briefs, selected, onChange, disabled }: Props) {
  if (briefs.length === 0) {
    return (
      <span className="text-xs italic text-muted-foreground">No briefs found in logs/briefs/</span>
    );
  }

  return (
    <Select value={selected} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" suppressHydrationWarning>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {briefs.map((b) => (
          <SelectItem key={b.slug} value={b.slug}>
            {b.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
