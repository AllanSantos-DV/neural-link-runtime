/**
 * Online learner for contextual scoring.
 * 
 * Implements Online Linear Regression per handler — the simplified core
 * of LinUCB (Li et al., 2010) without the exploration component.
 * 
 * Each handler has a weight vector W[VECTOR_SIZE]. The learned score for
 * a (handler, context) pair is: score = dot(W, features).
 * 
 * Weights are updated via online gradient descent:
 *   W[i] += learningRate * (reward - predicted) * feature[i]
 * 
 * Safety: floors/ceilings per handler prevent the learner from
 * overriding critical security decisions.
 * 
 * Persistence: weights stored as JSON in workspace or global path.
 */

import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { VECTOR_SIZE } from './features.js';

const WEIGHTS_DIR = join(homedir(), '.copilot', 'neural-link', 'weights');

/** Default learning config — overridable via neural-link.config.json */
const DEFAULTS = {
  lambda: 0.1,            // mix ratio: (1-λ) declarative + λ learned
  learningRate: 0.01,     // gradient step size — slow = stable
  minActivations: 20,     // don't adjust until N observations
  floors: {},             // per-handler minimum score (e.g. {pre-commit-guard: 0.8})
  ceilings: {},           // per-handler maximum score
};

/**
 * Learner instance — holds weight vectors for all handlers.
 */
export class Learner {
  constructor(config = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.weights = {};      // { handlerName: Float64Array(VECTOR_SIZE) }
    this.activations = {};  // { handlerName: number } — count of observations
    this._dirty = false;
    this._loaded = false;
    this._workspacePath = null; // set via load() — used by save()
    this._loadedFrom = null;   // path that was successfully loaded
  }

  /**
   * Load weights from disk. Idempotent — only loads once.
   * Stores workspacePath for later use by save().
   * If a weights file is corrupted, tries the .backup variant.
   */
  load(workspacePath = null) {
    if (this._loaded) return;
    this._loaded = true;
    if (workspacePath) this._workspacePath = workspacePath;

    const candidates = [];
    if (this._workspacePath) {
      const wsFile = join(this._workspacePath, '.neural-link.weights.json');
      candidates.push(wsFile);
      candidates.push(wsFile.replace('.json', '.backup.json'));
    }
    const globalFile = join(WEIGHTS_DIR, 'learned.json');
    candidates.push(globalFile);
    candidates.push(join(WEIGHTS_DIR, 'learned.backup.json'));

    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        const raw = readFileSync(path, 'utf-8');
        const data = JSON.parse(raw);
        if (data.weights) {
          for (const [name, arr] of Object.entries(data.weights)) {
            this.weights[name] = new Float64Array(arr);
          }
        }
        if (data.activations) {
          this.activations = { ...data.activations };
        }
        this._loadedFrom = path;
        return;
      } catch {
        continue;
      }
    }
  }

  /**
   * Predict learned score for a handler given feature vector.
   * Returns number in [0, 1].
   */
  predict(handlerName, featureVector) {
    const w = this.weights[handlerName];
    if (!w) return 0.5; // no data → neutral

    // Dot product
    let sum = 0;
    for (let i = 0; i < featureVector.length; i++) {
      if (featureVector[i]) {
        sum += w[i];
      }
    }

    // Sigmoid to squash into [0, 1]
    return sigmoid(sum);
  }

  /**
   * Combine declarative score with learned score.
   * Returns final score respecting floors/ceilings.
   * 
   * When no learned weights exist (cold start), returns declarative score
   * unmodified — the learner only influences after collecting data.
   */
  combine(handlerName, declarativeScore, featureVector) {
    // No weights yet → pure declarative (cold start)
    if (!this.weights[handlerName]) {
      return declarativeScore;
    }

    // Not enough observations → pure declarative (warm-up)
    if ((this.activations[handlerName] || 0) < this.config.minActivations) {
      return declarativeScore;
    }

    const lambda = this.config.lambda;
    const learned = this.predict(handlerName, featureVector);
    let score = (1 - lambda) * declarativeScore + lambda * learned;

    // Apply safety bounds
    const floor = this.config.floors[handlerName];
    const ceiling = this.config.ceilings[handlerName];
    if (floor != null && score < floor) score = floor;
    if (ceiling != null && score > ceiling) score = ceiling;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Update weights for a handler based on observed reward.
   * reward: 0.0 (bad decision) to 1.0 (good decision)
   */
  update(handlerName, featureVector, reward) {
    // Track activations
    this.activations[handlerName] = (this.activations[handlerName] || 0) + 1;

    // Don't adjust until minimum observations reached
    if (this.activations[handlerName] < this.config.minActivations) return;

    // Initialize weights if needed
    if (!this.weights[handlerName]) {
      this.weights[handlerName] = new Float64Array(VECTOR_SIZE);
    }

    const w = this.weights[handlerName];
    const predicted = this.predict(handlerName, featureVector);
    const error = reward - predicted;
    const lr = this.config.learningRate;

    // Online gradient descent
    for (let i = 0; i < featureVector.length; i++) {
      if (featureVector[i]) {
        w[i] += lr * error * featureVector[i];
      }
    }

    this._dirty = true;
  }

  /**
   * Persist weights to disk. Fire-and-forget.
   * Saves to workspace path if available, otherwise global.
   * No-op when _skipDiskLoad is set (test mode) to ensure idempotency.
   */
  async save() {
    if (_skipDiskLoad) return; // test mode — never persist
    if (!this._dirty) return;
    this._dirty = false;

    const data = {
      version: '1.0',
      vectorSize: VECTOR_SIZE,
      updatedAt: new Date().toISOString(),
      activations: this.activations,
      weights: {},
    };

    for (const [name, w] of Object.entries(this.weights)) {
      data.weights[name] = Array.from(w);
    }

    const json = JSON.stringify(data, null, 2);

    // Save to workspace if cwd available
    if (this._workspacePath) {
      const wsPath = join(this._workspacePath, '.neural-link.weights.json');
      const wsBackup = wsPath.replace('.json', '.backup.json');
      try {
        if (existsSync(wsPath)) {
          copyFileSync(wsPath, wsBackup);
        }
        await writeFile(wsPath, json);
      } catch {
        // Workspace save failed — fall through to global
      }
    }

    // Always save to global as well (fallback copy)
    const globalPath = join(WEIGHTS_DIR, 'learned.json');
    const globalBackup = join(WEIGHTS_DIR, 'learned.backup.json');
    try {
      await mkdir(WEIGHTS_DIR, { recursive: true });
      if (existsSync(globalPath)) {
        copyFileSync(globalPath, globalBackup);
      }
      await writeFile(globalPath, json);
    } catch {
      // Persistence failure is non-critical
    }
  }

  /**
   * Get stats for debugging/logging.
   */
  stats() {
    const s = {};
    for (const [name, count] of Object.entries(this.activations)) {
      s[name] = {
        activations: count,
        hasWeights: !!this.weights[name],
        learningActive: count >= this.config.minActivations,
      };
    }
    return s;
  }
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// Singleton learner instance
let _instance = null;
let _skipDiskLoad = false;

export function getLearner(config, workspacePath = null) {
  if (!_instance) {
    _instance = new Learner(config);
    if (!_skipDiskLoad) {
      _instance.load(workspacePath);
    }
  }
  return _instance;
}

// For testing — reset singleton. Pass skipDisk=true to prevent
// loading persisted weights (ensures idempotent test runs).
export function _resetLearner(skipDisk = false) {
  _instance = null;
  _skipDiskLoad = skipDisk;
}
