import hashlib
import json


def test_research_idea_links_and_result_conclusion(client):
    p = client.post('/api/projects', json={'name': 'proposal'}).json()['id']
    other = client.post('/api/projects', json={'name': 'other proposal'}).json()['id']
    proposal = client.post(f'/api/projects/{p}/research-ideas', json={'title': '完整思路', 'goal': '目标', 'innovation': '创新'}).json()
    created = client.post(f'/api/projects/{p}/ideas', json={'title': '直接创建', 'body': '可验证主张', 'research_idea_id': proposal['id']}).json()
    assert created['research_idea_id'] == proposal['id']
    assert client.post(f'/api/projects/{other}/ideas', json={'title': '错误归属', 'body': '正文', 'research_idea_id': proposal['id']}).status_code == 422
    hypothesis = client.post(f'/api/projects/{p}/ideas', json={'title': '假设', 'body': '可验证主张'}).json()
    run = client.post(f'/api/projects/{p}/runs', json={'name': '对照'}).json()
    foreign = client.post(f'/api/projects/{other}/runs', json={'name': '其他实验'}).json()
    assert client.patch(f"/api/ideas/{hypothesis['id']}", json={'research_idea_id': proposal['id']}).json()['research_idea_id'] == proposal['id']
    assert client.patch(f"/api/runs/{foreign['id']}", json={'research_idea_id': proposal['id']}).status_code == 422
    assert client.patch(f"/api/runs/{run['id']}", json={'research_idea_id': proposal['id']}).json()['research_idea_id'] == proposal['id']
    assert client.post(f"/api/research-ideas/{proposal['id']}/conclusions", json={'run_id': foreign['id'], 'content': '结论'}).status_code == 422
    result = client.post(f"/api/research-ideas/{proposal['id']}/conclusions", json={'run_id': run['id'], 'content': '结果支持假设，但样本量有限'}).json()
    assert result['run_id'] == run['id']


def test_proposal_source_preview_and_import_preserve_formula(client, monkeypatch):
    p = client.post('/api/projects', json={'name': 'formula'}).json()['id']
    idea = client.post(f'/api/projects/{p}/research-ideas', json={'title': '理论思路', 'goal': '原有目标'}).json()
    class Fake:
        def chat(self, system, user):
            return json.dumps({'theory': '若 $x>0$，则 $y=x^2$。证明：直接代入。', 'future_plan': '验证边界', 'hypotheses': [{'title': '可检验假设', 'body': '输入为正时满足关系'}]}, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_ideas.get_glm_client', lambda: Fake())
    source = '# 方案\n\n公式：$y=x^2$\n\n证明：直接代入。'
    body = {'filename': '方案.md', 'content': source}
    parsed = client.post(f"/api/research-ideas/{idea['id']}/documents/parse", json=body).json()
    assert parsed['source_hash'] == hashlib.sha256(source.encode()).hexdigest()
    assert client.get(f"/api/research-ideas/{idea['id']}/documents").json() == []
    saved = client.post(f"/api/research-ideas/{idea['id']}/documents", json={**body, 'sections': parsed['sections'], 'hypotheses': parsed['hypotheses'], 'source_hash': parsed['source_hash']})
    assert saved.status_code == 201
    document = client.get(f"/api/research-ideas/{idea['id']}/documents/{saved.json()['id']}").json()
    assert document['content'] == source
    updated = client.get(f"/api/research-ideas/{idea['id']}").json()
    assert updated['goal'] == '原有目标' and '$y=x^2$' in updated['theory']
    hypothesis = client.get(f'/api/projects/{p}/ideas').json()[0]
    assert hypothesis['research_idea_id'] == idea['id'] and hypothesis['versions'][0]['body'] == '输入为正时满足关系'
    assert client.post(f"/api/research-ideas/{idea['id']}/documents", json={**body, 'sections': parsed['sections'], 'source_hash': parsed['source_hash']}).status_code == 409
    assert client.post(f"/api/research-ideas/{idea['id']}/documents", json={**body, 'content': source + '修改', 'sections': parsed['sections'], 'source_hash': parsed['source_hash']}).status_code == 409
