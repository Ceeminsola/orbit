export type Role = "executive" | "ea";
export const CATS = ["Brain Dump","Task","Idea","Project","Person to Contact","Decision","Meeting","Reminder","Concern"];
export const EA_CATS = [...CATS, "Blocker", "Follow-up"];
export const TIMES = ["Urgent","This Week","Within 30 Days","Within 90 Days","Someday"];
export const STATUSES = ["New","Reviewed","Needs Clarification","Structured","In Progress","Transferred to Execution","Completed","Archived"] as const;
export type Status = (typeof STATUSES)[number];
export const LABEL: Record<string,string> = {New:"Received",Reviewed:"Received","Needs Clarification":"A question may be coming",Structured:"Organized","In Progress":"In progress","Transferred to Execution":"Handed off",Completed:"Done",Archived:"Archived"};
export interface Thought { id:string; executive_id:string; text:string; category:string|null; timing:string|null; people:string|null; deadline:string|null; deps:string|null; created_at:string }
export interface Entry { id:string; thought_id:string|null; parent_id:string|null; executive_id:string; text:string|null; status:Status; title:string; category:string; timing:string; next_action:string; owner:string; collab:string; deadline:string|null; deps:string; dest:string; project:string; exec_link:string; clarify:string; blocked:boolean; private_notes:string; share_next:string; needs_decision:boolean; trashed_at:string|null; version:number; created_at:string; thoughts:Thought|null }
export interface Update { entry_id:string; thought_id:string; status:string; share_next:string; needs_decision:boolean; trashed:boolean; updated_at:string }
export const sc = (s: string) => s.replace(/\W/g, "");
export const original = (e: Entry) => e.thoughts?.text ?? e.text ?? "";
