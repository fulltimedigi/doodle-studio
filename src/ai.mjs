// The "agent" half: turn a plain-language brief into a full script.json.
// Works with any OpenAI-compatible endpoint. Default = Ollama running locally (free, offline).
// Examples:  DOODLE_AI_ENDPOINT=http://localhost:11434/v1  DOODLE_AI_MODEL=qwen2.5:7b
//            (or a free-tier hosted key via DOODLE_AI_KEY)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './project.mjs';

export function systemPrompt() { return readFileSync(join(ROOT, 'prompts/script-writer.md'), 'utf8'); }

export async function generateScript(brief, { endpoint, model, apiKey, format = '16:9', language = 'ar', voice } = {}) {
  endpoint = (endpoint || process.env.DOODLE_AI_ENDPOINT || 'http://localhost:11434/v1').replace(/\/$/, '');
  model = model || process.env.DOODLE_AI_MODEL || 'qwen2.5:7b';
  apiKey = apiKey || process.env.DOODLE_AI_KEY || 'ollama';
  const icons = readFileSync(join(ROOT, 'assets/icons/INDEX.txt'), 'utf8').trim();
  const user = `Brief:\n${brief}\n\nConstraints:\n- format: ${format}\n- language of on-screen text and narration: ${language}\n- voice: ${voice || (language === 'ar' ? 'ar-EG-Salma' : 'en-US-Aria')}\n- available icon names: ${icons}\n\nReturn ONLY the JSON.`;
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.7, messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`AI endpoint ${endpoint} answered ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const json = text.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1');
  let script;
  try { script = JSON.parse(json); } catch (e) { throw new Error(`The model did not return valid JSON. Raw answer:\n${text}`); }
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error('Script has no scenes.');
  script.format = script.format || format; script.voice = script.voice || voice || (language === 'ar' ? 'ar-EG-Salma' : 'en-US-Aria');
  return script;
}
