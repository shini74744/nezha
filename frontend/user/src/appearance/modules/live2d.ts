// Live2D Widget 0.9.1, GPL-3.0-or-later; see public/appearance/LICENSE-live2d.txt.
import { FeatureScope } from "../scope";
import { live2dRuntime } from "../vendor/live2d-runtime";
import { asteroids } from "./asteroids";

export function live2d(scope: FeatureScope, config: { cdnPath: string; tools: string[] }) {
  if (screen.width < 768) return;
  let gameScope: FeatureScope | undefined;
  scope.own(() => gameScope?.dispose());
  function startNativeGame() {
    gameScope?.dispose();
    gameScope = new FeatureScope("asteroids");
    asteroids(gameScope, {});
  }
  live2dRuntime(scope, config, startNativeGame);
}
