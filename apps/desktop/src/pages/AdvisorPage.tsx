import { Bot, Send, Sparkles, User } from 'lucide-react';

import { Button, Card, EmptyState, Textarea } from '@ledgerpilot/ui';

import { PageHeader } from '../components/PageHeader';
import { useWorkspace } from '../context/WorkspaceContext';

const suggestedQuestions = [
  'Where am I overspending?',
  'How can I save 10000 in 3 months?',
  'What changed compared to last month?',
  'How much interest have I paid?',
  'Which subscriptions should I cancel?'
];

export const AdvisorPage = () => {
  const { advisorQuestion, setAdvisorQuestion, advisorResponse, isWorking, handleAskAdvisor, settings } = useWorkspace();

  const submit = () => {
    void handleAskAdvisor();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Advisor"
        title="Ask your finances anything"
        description={`Grounded in your imported transaction history. Running on ${
          settings.aiProvider === 'local-rules' ? 'local rules (no data leaves this Mac)' : settings.aiProvider
        }.`}
      />

      <Card className="bg-slate-900/70 p-7">
        {!advisorResponse ? (
          <EmptyState
            icon={<Bot />}
            title="Ask a question to get started"
            description="Try one of the suggestions below, or write your own."
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-end gap-3">
              <div className="max-w-xl rounded-2xl rounded-tr-sm bg-sky-500/15 px-4 py-3 text-sm text-slate-100">
                {advisorQuestion}
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800">
                <User className="h-4 w-4 text-slate-400" />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="max-w-2xl space-y-3 rounded-2xl rounded-tl-sm bg-slate-950/70 px-4 py-3.5 text-sm">
                <p className="leading-7 text-slate-200">{advisorResponse.answer}</p>
                {advisorResponse.insights.length > 0 ? (
                  <div className="space-y-2 border-t border-white/5 pt-3">
                    {advisorResponse.insights.map((insight) => (
                      <div key={insight.title} className="rounded-xl bg-slate-900/70 p-3">
                        <p className="font-medium text-slate-100">{insight.title}</p>
                        <p className="mt-1 text-slate-300">{insight.detail}</p>
                        <p className="mt-1.5 text-xs text-slate-500">{insight.supportingData}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {suggestedQuestions.map((question) => (
            <button
              key={question}
              onClick={() => setAdvisorQuestion(question)}
              className="rounded-full border border-white/10 bg-slate-950/60 px-3.5 py-1.5 text-xs text-slate-400 transition-colors hover:border-sky-400/30 hover:text-sky-300"
            >
              {question}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-end gap-3">
          <Textarea
            className="min-h-[3.25rem] flex-1"
            value={advisorQuestion}
            onChange={(event) => setAdvisorQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about spending, savings, subscriptions, debt..."
          />
          <Button disabled={isWorking || !advisorQuestion.trim()} onClick={submit} icon={<Send />}>
            Ask
          </Button>
        </div>
      </Card>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <Sparkles className="h-3.5 w-3.5" />
        Answers are generated from your local data. Cloud providers (Ollama/OpenAI-compatible) are opt-in in Settings.
      </div>
    </div>
  );
};
