/**
 * 运行期问题卡（M8 #4）：ask_user_question 挂起-作答的交互面。
 * 选项一键作答 + 自由输入；作答后挂起完成、流式恢复。
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RuntimeQuestionDto } from '../types';

export interface QuestionCardProps {
  questions: RuntimeQuestionDto[];
  onAnswer: (questionId: string, answer: string) => void;
}

function QuestionItem({
  question,
  onAnswer,
}: {
  question: RuntimeQuestionDto;
  onAnswer: (questionId: string, answer: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState('');
  return (
    <div className="question-card">
      <div className="question-card__head">
        <span className="question-card__badge">向你提问</span>
      </div>
      <div className="question-card__title">{question.question}</div>
      {question.options.length > 0 ? (
        <div className="question-card__options">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className="question-card__option"
              onClick={() => onAnswer(question.questionId, option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <div className="question-card__actions">
        <input
          value={draft}
          placeholder="或输入你的回答…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() !== '') {
              onAnswer(question.questionId, draft.trim());
            }
          }}
        />
        <button
          type="button"
          className="btn btn--primary btn--small"
          disabled={draft.trim() === ''}
          onClick={() => onAnswer(question.questionId, draft.trim())}
        >
          提交
        </button>
      </div>
    </div>
  );
}

export default function QuestionCard({ questions, onAnswer }: QuestionCardProps): ReactElement | null {
  if (questions.length === 0) {
    return null;
  }
  return (
    <div className="approval-stack">
      {questions.map((question) => (
        <QuestionItem key={question.questionId} question={question} onAnswer={onAnswer} />
      ))}
    </div>
  );
}
