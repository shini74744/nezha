// The Doraemon scope never imports or rewrites the default theme's settings.
export const doraemonDefinitions = [
 {key:"traffic",title:"流量进度条",description:"本期用量、周期和进度条；不影响实时网速与累计流量。",defaults:{enabled:true,toggleInterval:5000},labels:{toggleInterval:"信息轮换间隔（毫秒）"},constraints:{toggleInterval:[1000,60000]}},
 {key:"friendsBanner",title:"伙伴同框",description:"顶部展示哆啦 A 梦、大雄、静香、胖虎和小夫，手机保留全部五位伙伴。",defaults:{enabled:true},labels:{},constraints:{}},
 {key:"friendsInteraction",title:"伙伴互动",description:"页底点击人物切换一句问候，无声音、无自动弹窗，不遮挡服务器。",defaults:{enabled:true},labels:{},constraints:{}},
 {key:"gadgetDecorations",title:"道具装饰",description:"竹蜻蜓连接动画、四次元口袋里的任意门和记忆面包；尊重设备的减少动态效果设置。",defaults:{enabled:true},labels:{},constraints:{}},
 {key:"backToTop",title:"竹蜻蜓返回顶部",description:"列表加载后，向下滚动超过 300 像素时在右下角显示竹蜻蜓；点击返回顶部，手机自动适配安全边距。",defaults:{enabled:true},labels:{},constraints:{}},
 {key:"speedColor",title:"速率颜色",description:"顶部与服务器卡片复用上传红色、下载蓝色的速率颜色规则；白天加深保证清晰，不改变单位与布局，不影响默认主题。",defaults:{enabled:true},labels:{},constraints:{}},
 {key:"speedAnimation",title:"高速率动画特效",description:"顶部与服务器卡片沿用原有速率分档，显示发光、闪动与背景脉动；独立于速率颜色，屏幕外暂停，并尊重设备减少动态效果设置。",defaults:{enabled:true},labels:{},constraints:{}},
 {key:"cardGadgets",title:"卡片秘密道具",description:"按服务器 ID 稳定分配动画道具，图标与名称一一对应，刷新、排序不更换。",defaults:{enabled:true},labels:{},constraints:{}},
] as const;
export type DoraemonFeature = typeof doraemonDefinitions[number]["key"];
export type DoraemonConfig = {version:1;enabled:boolean;features:Record<string,{enabled:boolean;[key:string]:unknown}>};
export function doraemonDefaults():DoraemonConfig {
 return {version:1,enabled:true,features:Object.fromEntries(doraemonDefinitions.map(d=>[d.key,{...d.defaults}]))};
}
export function validateDoraemon(config:DoraemonConfig):string {
 if(!config||config.version!==1||typeof config.enabled!=="boolean"||!config.features||Array.isArray(config.features))return "哆啦 A 梦配置格式无效";
 for(const [key,f] of Object.entries(config.features)){
  const definition=doraemonDefinitions.find(d=>d.key===key);
  if(!definition||!f||Array.isArray(f)||typeof f.enabled!=="boolean")return "未知或无效的道具功能："+key;
  if(Object.keys(f).some(k=>!Object.prototype.hasOwnProperty.call(definition.defaults,k)))return "功能包含未知参数："+key;
 }
 const interval=config.features.traffic?.toggleInterval;
 if(typeof interval!=="number"||!Number.isFinite(interval)||interval<1000||interval>60000)return "信息轮换间隔须在 1000–60000 毫秒之间";
 return "";
}
// Missing NEW features opt in; an explicit false (including the master switch) always wins.
// Invalid documents fail closed. Pending settings are handled by the provider, not defaults.
export function normalizeDoraemon(raw?:string|DoraemonConfig):DoraemonConfig {
 const base=doraemonDefaults();
 if(raw===undefined||raw==="")return base;
 try {
  const doc=typeof raw==="string"?JSON.parse(raw):raw;
  if(validateDoraemon(doc))return {...base,enabled:false};
  return {...base,enabled:doc.enabled,features:{...base.features,...doc.features}};
 }catch{return {...base,enabled:false}}
}
