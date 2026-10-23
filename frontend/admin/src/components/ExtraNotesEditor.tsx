import {useTranslation} from "react-i18next";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {type PublicNote} from "@/lib/public-note";
import {extraNotes,extraNoteColor,reconcileExtraColors} from "../../../shared/extra-note-colors";
import CarrierColorPicker from "./CarrierColorPicker";
export default function ExtraNotesEditor({note,onChange}:{note:PublicNote;onChange:(note:PublicNote)=>void}){
 const {t}=useTranslation(),plan=note.planDataMod||{},notes=extraNotes(plan.extra);
 return <div className="space-y-1 sm:col-span-2" data-extra-notes-editor>
  <div className="flex flex-wrap items-center gap-1">
   <Label htmlFor="plan-extra" className="text-xs">{t("PublicNote.Extra")}</Label>
   {notes.map((text,index)=><CarrierColorPicker key={index} compact label={"额外备注 "+(index+1)+"（"+text+"）"}
    fallback={extraNoteColor(undefined,index)} value={plan.extraColors?.[index]}
    onChange={color=>{const extraColors=notes.map((_,i)=>plan.extraColors?.[i]||"");extraColors[index]=color||"";
     onChange({...note,planDataMod:{...plan,extraColors}})}}/>)}
  </div>
  <Input id="plan-extra" placeholder={t("PublicNote.CommaSeparated")} value={plan.extra||""}
   onChange={e=>{const extra=e.target.value,extraColors=reconcileExtraColors(plan.extra,extra,plan.extraColors);
    onChange({...note,planDataMod:{...plan,extra,...(extraColors!==undefined?{extraColors}:{})}})}}/>
 </div>;
}
