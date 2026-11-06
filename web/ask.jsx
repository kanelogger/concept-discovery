import React from "react";
import { Alert, Button, Flex, Form, Input, Spin, Typography } from "antd";

const { Title, Text, Paragraph, Link } = Typography;

function AskEvidence({ items }) {
  return items.map(evidence => <blockquote key={evidence.id} className="ask-evidence">
    <Text type="secondary">{evidence.readingId ? "补充阅读 · " + evidence.readingTitle : "卡片正文"}</Text>
    <p>{evidence.text}</p>
  </blockquote>);
}

export function AskCardContext({ question, card }) {
  return <section className="ask-card-context" aria-labelledby="ask-card-context-heading">
    <Title id="ask-card-context-heading" level={2}>为什么推荐这张卡</Title>
    <Paragraph type="secondary" className="ask-context-question">你的问题：{question}</Paragraph>
    <Paragraph className="ask-reason">{card.reason}</Paragraph>
    {card.evidence.length > 0 && <>
      <Text strong>命中片段</Text>
      <AskEvidence items={card.evidence} />
    </>}
  </section>;
}

function AskResults({ result, workspace }) {
  const { question, data } = result;
  const titles = new Map(data.cards.map(card => [card.id, card.title]));
  return <section id="ask-results" aria-labelledby="ask-result-title" className="ask-results">
    <header>
      <Title id="ask-result-title" level={2}>{data.status === "no_match" ? "本次未找到可用依据" : data.status === "insufficient" ? "当前资料不足" : "应用建议"}</Title>
      <Paragraph type="secondary">{question}</Paragraph>
    </header>
    {data.cards.length > 0 && <section aria-labelledby="ask-cards-title">
      <Title id="ask-cards-title" level={3}>推荐卡片</Title>
      <ul className="ask-cards">
        {data.cards.map(card => <li key={card.id} className="ask-card">
          <Title level={4}><Link className="card-title-link" data-card-id={card.id} href={workspace.href("detail", card.id)}>
            {card.title || "未命名卡片"}
          </Link></Title>
          <Paragraph className="ask-reason">{card.reason}</Paragraph>
          <AskEvidence items={card.evidence} />
          <Paragraph className="ask-boundary"><Text strong>使用边界</Text> {card.boundary}</Paragraph>
        </li>)}
      </ul>
    </section>}
    {data.steps.length > 0 && <section aria-labelledby="ask-steps-title">
      <Title id="ask-steps-title" level={3}>建议步骤</Title>
      <ol className="ask-steps">{data.steps.map((step, index) => <li key={index}>
        <div>{step.action}</div>
        <Text type="secondary">依据卡片 · {step.cardIds.map(id => titles.get(id)).join("、")}</Text>
      </li>)}</ol>
    </section>}
    {data.gaps.length > 0 && <section aria-labelledby="ask-gaps-title">
      <Title id="ask-gaps-title" level={3}>资料缺口</Title>
      <ul className="ask-gaps">{data.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
    </section>}
  </section>;
}

export function AskPanel({ state, workspace }) {
  const validQuestion = state.askQuestion.trim() && Array.from(state.askQuestion.trim()).length <= 1000;
  const locked = state.askBusy || state.navigating || state.editorLoading;
  return <div className="ask-panel">
    {state.askAvailable ? <Form id="ask-form" className="ask-form" layout="vertical" onFinish={() => void workspace.submitAsk()}>
      <Form.Item label="想了解什么" htmlFor="ask-question">
        <Input.TextArea id="ask-question" value={state.askQuestion} readOnly={locked}
          aria-describedby="ask-data-note" rows={3}
          count={{ show: true, max: 1000, strategy: value => Array.from(value).length }}
          maxLength={2000} placeholder="项目上线前怎样排查失败风险？"
          onChange={event => workspace.setAskQuestion(event.target.value)} />
      </Form.Item>
      <Flex align="center" justify="space-between" wrap gap={16}>
        <Text id="ask-data-note" type="secondary">提交后，模型服务会收到本次问题、有限的卡名与适用任务描述，以及少量正文片段。</Text>
        <Flex gap={8}>
          {state.askBusy && <Button id="cancel-ask" onClick={workspace.cancelAsk}>取消</Button>}
          <Button id="submit-ask" htmlType="submit" type="primary" disabled={!validQuestion || locked}>查找并分析</Button>
        </Flex>
      </Flex>
    </Form> : <Alert type="info" showIcon title="按问题找卡尚未配置" description="配置模型服务后即可使用。现在可以继续用关键词搜索。" />}
    <div className="ask-status" role="status" aria-live="polite">
      {state.askBusy && <Flex align="center" gap={10}><Spin size="small" />正在查找资料并整理建议…</Flex>}
      {state.askMessage && <Alert type={state.askMessage.error ? "error" : "info"} showIcon title={state.askMessage.text} />}
    </div>
    {state.askResult && <AskResults result={state.askResult} workspace={workspace} />}
  </div>;
}
