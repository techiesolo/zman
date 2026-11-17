import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export type MenuEntry =
  | "separator"
  | {
      label: string;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      onSelect(): void;
    };

/** The same entries can back a right-click menu and a "more" button. */
function entries(list: MenuEntry[], Item: typeof DropdownMenu.Item, Separator: typeof DropdownMenu.Separator) {
  return list.map((entry, index) =>
    entry === "separator" ? (
      <Separator key={index} className="menu-separator" />
    ) : (
      <Item
        key={index}
        className="menu-item"
        data-danger={entry.danger ? "" : undefined}
        disabled={entry.disabled}
        onSelect={entry.onSelect}
      >
        {entry.icon && <span className="flex w-4 justify-center opacity-80">{entry.icon}</span>}
        {entry.label}
      </Item>
    ),
  );
}

interface DropdownProps {
  entries: MenuEntry[];
  align?: "start" | "end";
  /** The trigger; must be a single element that accepts a ref, such as a button. */
  children: ReactNode;
}

export function Dropdown({ entries: list, align = "start", children }: DropdownProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align={align} sideOffset={4} onCloseAutoFocus={(e) => e.preventDefault()}>
          {entries(list, DropdownMenu.Item, DropdownMenu.Separator)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function WithContextMenu({ entries: list, children }: { entries: MenuEntry[]; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu" onCloseAutoFocus={(e) => e.preventDefault()}>
          {entries(
            list,
            ContextMenu.Item as typeof DropdownMenu.Item,
            ContextMenu.Separator as typeof DropdownMenu.Separator,
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
