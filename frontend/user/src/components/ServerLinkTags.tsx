import {safeLink,validLinkTags} from "../../../shared/link-tags";
export default function ServerLinkTags({tags}:{tags:unknown}){
 const links=validLinkTags(tags);if(!links.length)return null;
 return <div data-server-link-tags className="mt-1 flex max-w-full flex-wrap gap-1">
  {links.map((tag,i)=><a key={i} href={safeLink(tag.url)} target="_blank" rel="noopener noreferrer"
   onClick={e=>e.stopPropagation()} onAuxClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}
   className="max-w-full break-words rounded px-1.5 py-0.5 text-[10px] leading-tight text-sky-100 bg-sky-700 hover:bg-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
   title={tag.name+"（在新标签页打开）"}>{tag.name}</a>)}
 </div>;
}
