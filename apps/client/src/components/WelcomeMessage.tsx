import type { ModelCapabilityInfo } from '../types';

interface WelcomeMessageProps {
  selectedModel?: ModelCapabilityInfo;
}

export function WelcomeMessage({ selectedModel }: WelcomeMessageProps) {
  return (
    <div className="welcome-message">
      <div className="welcome-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <h2>Welcome to NIM Hub</h2>
      <p>Your personal NVIDIA AI workstation</p>
      <div className="welcome-hints">
        <span className="hint">Select a model from the dropdown</span>
        <span className="hint">Attach images for vision models 👁️</span>
        <span className="hint">Conversations are saved automatically</span>
      </div>
      {selectedModel && (
        <div className="selected-model-hint">
          Current model: <strong>{selectedModel.name ?? selectedModel.id}</strong>
        </div>
      )}
    </div>
  );
}