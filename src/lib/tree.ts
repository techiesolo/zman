import { newId } from "../model/factory";
import type { Collection, FolderItem, Item, KV, RequestItem } from "../model/types";

export interface Located {
  item: Item;
  /** The array that holds `item`. */
  siblings: Item[];
  index: number;
  /** Enclosing folders, outermost first. */
  ancestors: FolderItem[];
}

export function locate(collection: Collection, id: string): Located | null {
  const search = (items: Item[], ancestors: FolderItem[]): Located | null => {
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      if (item.id === id) return { item, siblings: items, index, ancestors };
      if (item.type === "folder") {
        const found = search(item.items, [...ancestors, item]);
        if (found) return found;
      }
    }
    return null;
  };
  return search(collection.items, []);
}

export function findRequest(collection: Collection | undefined, id: string): RequestItem | null {
  if (!collection) return null;
  const found = locate(collection, id);
  return found?.item.type === "request" ? found.item : null;
}

/** The items array of a folder, or of the collection root when `folderId` is null. */
export function childrenOf(collection: Collection, folderId: string | null): Item[] | null {
  if (folderId === null) return collection.items;
  const found = locate(collection, folderId);
  return found?.item.type === "folder" ? found.item.items : null;
}

export function walk(items: Item[], visit: (item: Item, depth: number) => void, depth = 0): void {
  for (const item of items) {
    visit(item, depth);
    if (item.type === "folder") walk(item.items, visit, depth + 1);
  }
}

export function countRequests(items: Item[]): number {
  let n = 0;
  walk(items, (item) => {
    if (item.type === "request") n++;
  });
  return n;
}

export function containsId(item: Item, id: string): boolean {
  if (item.id === id) return true;
  return item.type === "folder" && item.items.some((child) => containsId(child, id));
}

export interface FolderOption {
  id: string;
  name: string;
  depth: number;
}

export function listFolders(collection: Collection): FolderOption[] {
  const out: FolderOption[] = [];
  walk(collection.items, (item, depth) => {
    if (item.type === "folder") out.push({ id: item.id, name: item.name, depth });
  });
  return out;
}

function freshRows<T extends KV>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row, id: newId() }));
}

/** Deep copy with new ids everywhere, so the copy can live next to the original. */
export function cloneItem(item: Item): Item {
  const copy = structuredClone(item);
  const renew = (node: Item) => {
    node.id = newId();
    if (node.type === "folder") {
      node.items.forEach(renew);
      return;
    }
    const r = node.request;
    r.params = freshRows(r.params);
    r.pathVars = freshRows(r.pathVars);
    r.headers = freshRows(r.headers);
    r.body.urlencoded = freshRows(r.body.urlencoded);
    r.body.formdata = freshRows(r.body.formdata);
  };
  renew(copy);
  return copy;
}

export function cloneCollection(collection: Collection): Collection {
  const copy = structuredClone(collection);
  copy.id = newId();
  copy.variables = freshRows(copy.variables);
  copy.items = copy.items.map(cloneItem);
  return copy;
}
