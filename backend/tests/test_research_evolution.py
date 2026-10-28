import json


def test_three_ideas_evolve_from_experiment_and_discussion(client, monkeypatch):
    project = client.post('/api/projects', json={'name': 'evolution acceptance'}).json()['id']
    model_output = {
        'ideas': [
            {'local_ref': 'idea-a', 'title': '整体分配', 'methods': '整体分配资源', 'status': 'paused', 'status_reason': '成本太高', 'hypotheses': [{'title': '难度假设', 'body': '困难任务需要更大资源'}], 'versions': [{'methods':'初始规则','change_reason':'初始想法'},{'methods':'整体分配资源','change_reason':'补充机制'}]},
            {'local_ref': 'idea-b', 'title': '按层分配', 'methods': '按层重要性分配', 'status': 'promising', 'status_reason': '初步观察'},
            {'local_ref': 'idea-c', 'title': '联合分配', 'methods': '结合任务与层级'},
        ],
        'runs': [
            {'local_ref': 'run-1', 'idea_ref': 'idea-a', 'name': '运行检查', 'status': 'failed', 'notes': '代码 Bug，不能判断 Idea', 'metrics': []},
            {'local_ref': 'run-3', 'idea_ref': 'idea-a', 'name': '成本观察', 'status': 'succeeded', 'notes': '发现资源消耗偏高'},
            {'local_ref': 'run-2', 'idea_ref': 'idea-b', 'name': '对照实验', 'status': 'succeeded', 'metrics': [{'name':'accuracy','step':0,'value':0.8}]},
        ],
        'evidence': [{'idea_ref':'idea-a', 'hypothesis_title':'难度假设', 'run_ref':'run-3', 'verdict':'inconclusive', 'note':'成本观察还不能判断假设'}],
        'edges': [
            {'source_ref':'idea-a', 'target_ref':'idea-b', 'relation_type':'pivoted_from', 'reason':'需要降低成本', 'trigger_type':'experiment', 'trigger_description':'资源消耗偏高', 'linked_run_refs': ['run-3']},
            {'source_ref':'idea-b', 'target_ref':'idea-c', 'relation_type':'branches_from', 'reason':'讨论中想到结合两种方式', 'trigger_type':'discussion', 'linked_run_refs': []},
        ],
    }
    class Fake:
        def chat(self, system, user): return json.dumps(model_output, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    body = {'filename':'演化.md', 'content':'完整科研讨论，实验 1 是代码 Bug；方案因成本暂停。'}
    response = client.post(f'/api/projects/{project}/research-evolution/parse', json=body)
    assert response.status_code == 200
    parsed = response.json()
    assert len(parsed['draft']['ideas']) == 3
    assert client.get(f'/api/projects/{project}/research-evolution').json()['nodes'] == []
    applied = client.post(f'/api/projects/{project}/research-evolution/apply', json={**body, 'source_hash':parsed['source_hash'], 'draft':parsed['draft']})
    assert applied.status_code == 201, applied.text
    assert applied.json()['counts']['evidence'] == 1
    graph = client.get(f'/api/projects/{project}/research-evolution').json()
    assert len(graph['nodes']) == 3 and len(graph['edges']) == 2
    assert graph['nodes'][0]['status'] == 'paused' and graph['nodes'][0]['status_reason'] == '成本太高'
    assert graph['edges'][0]['trigger_type'] == 'experiment' and len(graph['edges'][0]['linked_run_ids']) == 1
    assert graph['edges'][1]['trigger_type'] == 'discussion'
    assert graph['nodes'][0]['hypothesis_count'] == 1 and graph['nodes'][0]['run_count'] == 2
    history = client.get(f"/api/research-ideas/{graph['nodes'][0]['id']}/versions").json()
    assert len(history) >= 2 and history[-1]['snapshot']['methods'] == '初始规则'
    assert all(node['title'] != '难度假设' for node in graph['nodes'])
    assert client.get(f'/api/projects/{project}/runs').json()[0]['status'] in ('failed', 'succeeded')
    assert client.post(f'/api/projects/{project}/research-evolution/apply', json={**body, 'source_hash':parsed['source_hash'], 'draft':parsed['draft']}).status_code == 409
    item = graph['nodes'][1]['id']
    assert client.patch(f'/api/research-ideas/{item}', json={'methods':'更新后的具体细化', 'change_reason':'补充细节'}).status_code == 200
    versions = client.get(f'/api/research-ideas/{item}/versions').json()
    assert len(versions) == 2 and versions[1]['snapshot']['methods'] == '按层重要性分配'


def test_ambiguous_match_requires_review_and_errors_roll_back(client, monkeypatch):
    project = client.post('/api/projects', json={'name':'ambiguous evolution'}).json()['id']
    existing = client.post(f'/api/projects/{project}/research-ideas', json={'title':'同名思路','methods':'已有方案'}).json()
    class Fake:
        def chat(self, system, user): return json.dumps({'ideas':[{'local_ref':'a','title':'同名思路','methods':'新方案'}], 'edges':[]}, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    source = {'filename':'report.md','content':'不同的研究报告'}
    parsed = client.post(f'/api/projects/{project}/research-evolution/parse', json=source).json()
    assert parsed['draft']['ideas'][0]['action'] == 'unresolved'
    assert parsed['draft']['ideas'][0]['candidates'] == [existing['id']]
    response = client.post(f'/api/projects/{project}/research-evolution/apply', json={**source,'source_hash':parsed['source_hash'],'draft':parsed['draft']})
    assert response.status_code == 422
    assert len(client.get(f'/api/projects/{project}/research-ideas').json()) == 1


def test_failed_import_rolls_back_everything(client, monkeypatch):
    project = client.post('/api/projects', json={'name': 'rollback'}).json()['id']
    class Fake:
        def chat(self, system, user):
            return json.dumps({'ideas': [{'local_ref':'a','title':'甲'}, {'local_ref':'b','title':'乙'}], 'edges':[{'source_ref':'a','target_ref':'b','relation_type':'derived_from','linked_run_refs':['missing']}]}, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    source = {'filename':'report.md','content':'回滚检查'}
    parsed = client.post(f'/api/projects/{project}/research-evolution/parse', json=source).json()
    payload = {**source, 'source_hash':parsed['source_hash'], 'draft':parsed['draft']}
    assert client.post(f'/api/projects/{project}/research-evolution/apply', json=payload).status_code == 422
    assert client.get(f'/api/projects/{project}/research-evolution').json()['nodes'] == []
    payload['draft']['edges'][0]['linked_run_refs'] = []
    assert client.post(f'/api/projects/{project}/research-evolution/apply', json=payload).status_code == 201
    graph = client.get(f'/api/projects/{project}/research-evolution').json()
    edge = graph['edges'][0]['id']
    assert client.delete(f'/api/research-evolution/edges/{edge}').status_code == 200
    graph = client.get(f'/api/projects/{project}/research-evolution').json()
    assert len(graph['nodes']) == 2 and graph['edges'] == []


def test_model_format_variations_are_preserved_for_review(client, monkeypatch):
    project = client.post('/api/projects', json={'name': 'format variations'}).json()['id']
    model_output = {
        'ideas': [{'local_ref':'a','title':'历史候选', 'status':'历史候选/统计对照，未被证实有效', 'related_evidence':['run-01','run-02'], 'versions':[{'methods':'旧方案','status':'被后续版本替代'}]}],
        'runs':[{'local_ref':'run-01','idea_ref':'a','name':'历史实验','status':'completed','params':'控制叶大小、先验和回退'}],
        'edges':[{'source_ref':'a','target_ref':'b','source_references':['S02 §6','方案.md']}],
        'evidence':[{'idea_ref':'a','hypothesis_title':'假设','run_ref':'run-01','verdict':'uncertain'}],
    }
    class Fake:
        def chat(self, system, user): return json.dumps(model_output, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    result = client.post(f'/api/projects/{project}/research-evolution/parse', json={'filename':'report.md','content':'源报告'})
    assert result.status_code == 200, result.text
    output = result.json()
    idea, run = output['draft']['ideas'][0], output['draft']['runs'][0]
    assert idea['status'] is None and '历史候选/统计对照，未被证实有效' in idea['status_reason']
    assert idea['related_evidence'] == 'run-01\nrun-02'
    assert idea['versions'][0]['status'] is None and '被后续版本替代' in idea['versions'][0]['status_reason']
    assert run['status'] is None and run['action'] == 'skip' and 'completed' in run['notes']
    assert run['params'] == {'原始参数说明':'控制叶大小、先验和回退'}
    assert output['draft']['edges'][0]['source_references'] == 'S02 §6\n方案.md'
    assert output['draft']['evidence'][0]['verdict'] == 'inconclusive'
    assert output['warnings']
