function safeProviderError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function buildConversationContents({ systemPrompt, history = [], userText, mediaBase64 = null, mediaMimeType = null }) {
  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Understood. I will assist customers based strictly on approved business information.' }] },
  ];
  for (const message of history) {
    if (!message?.content) continue;
    contents.push({ role: message.role === 'user' ? 'user' : 'model', parts: [{ text: String(message.content).slice(0, 12000) }] });
  }
  const parts = [{ text: String(userText || '').slice(0, 12000) }];
  if (mediaBase64 && mediaMimeType) parts.push({ inlineData: { mimeType: mediaMimeType, data: mediaBase64 } });
  contents.push({ role: 'user', parts });
  return contents;
}

export const GeminiAdapter = Object.freeze({
  name: 'gemini',

  async generateText({ apiKey, model = 'gemini-3.6-flash', systemPrompt, history, userText, mediaBase64, mediaMimeType }) {
    if (!apiKey) throw safeProviderError('provider_key_unavailable', 503);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: buildConversationContents({ systemPrompt, history, userText, mediaBase64, mediaMimeType }),
        generationConfig: { temperature: 0.65, maxOutputTokens: 350, topP: 0.9, topK: 40 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw safeProviderError('provider_generation_failed', response.status);
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) throw safeProviderError('provider_empty_response', 502);
    return { text: text.slice(0, 4096), provider: 'gemini', model };
  },

  async transcribeAudio({ apiKey, model = 'gemini-3.6-flash', mediaBase64, mimeType = 'audio/ogg' }) {
    if (!apiKey) throw safeProviderError('provider_key_unavailable', 503);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe this WhatsApp voice message faithfully. Return only the spoken transcript, with no commentary, translation, markdown, or invented details. Preserve the language used by the speaker.' },
            { inlineData: { mimeType, data: mediaBase64 } },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 1200 },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw safeProviderError('provider_transcription_failed', response.status);
    const transcript = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!transcript) throw safeProviderError('provider_empty_transcript', 502);
    return { transcript: transcript.slice(0, 12000), provider: 'gemini', model };
  },
});
