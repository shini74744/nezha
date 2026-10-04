import {normalize, validate, type AppearanceConfig, type FeatureDefinition} from "./appearance-config";
import {doraemonDefinitions,normalizeDoraemon,validateDoraemon} from "../../../shared/doraemon-appearance";
export type AppearanceTheme = "user-dist" | "doraemon-dist";
export const appearanceThemeNames: Record<AppearanceTheme,string> = {
 "user-dist":"默认主题", "doraemon-dist":"哆啦 A 梦",
};
export const doraDefinitions=doraemonDefinitions as unknown as FeatureDefinition[];
export const appearanceEndpoint = (theme:AppearanceTheme) =>
 "/api/v1/setting/appearance" + (theme==="user-dist" ? "" : "?theme=doraemon-dist");
export function appearancePayload(theme:AppearanceTheme, config:AppearanceConfig):AppearanceConfig {
 if(theme==="user-dist")return config;
 return {version:1,enabled:config.enabled,features:Object.fromEntries(doraDefinitions.map(d=>[d.key,{...config.features[d.key]}]))};
}
export function normalizeThemeAppearance(theme:AppearanceTheme, raw?:AppearanceConfig):AppearanceConfig {
 return theme==="user-dist"?normalize(raw):normalizeDoraemon(raw);
}
export function validateThemeConfig(theme:AppearanceTheme, config:AppearanceConfig){
 return theme==="user-dist"?validate(config):validateDoraemon(config);
}
