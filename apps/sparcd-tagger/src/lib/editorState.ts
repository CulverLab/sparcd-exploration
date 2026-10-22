import { create } from 'zustand';

/** Unfinished form input is separate from accepted, durably queued actions. */
export const useEditorState = create<{ unfinished: Record<string, boolean> }>(() => ({ unfinished: {} }));
export function unfinishedEditor(id: string, pending: boolean): void {
  useEditorState.setState(s => {
    const unfinished = { ...s.unfinished };
    if (pending) unfinished[id] = true; else delete unfinished[id];
    return { unfinished };
  });
}
export const hasUnfinishedEditor = () => Object.keys(useEditorState.getState().unfinished).length > 0;
