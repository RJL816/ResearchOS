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
    payload['draft']['edges'][0]['include'] = True
    payload['draft']['edges'][0]['linked_run_refs'] = ['missing']
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


def test_conflicting_run_refs_are_reviewed_without_losing_the_report(client, monkeypatch):
    from types import SimpleNamespace
    project = client.post('/api/projects', json={'name':'reference collision'}).json()['id']
    monkeypatch.setattr('app.routers.research_evolution.get_settings', lambda: SimpleNamespace(segment_max_chars=4, glm_json_parse_retries=0))
    replies = [
        {'ideas':[{'local_ref':'idea-a','title':'甲', 'hypotheses':[{'title':'假设','body':'正文'}]}],
         'runs':[{'local_ref':'run-04','idea_ref':'idea-a','name':'实验 A','status':'succeeded'}],
         'edges':[{'source_ref':'idea-a','target_ref':'idea-b','linked_run_refs':['run-04']}],
         'evidence':[{'idea_ref':'idea-a','hypothesis_title':'假设','run_ref':'run-04','verdict':'inconclusive'}]},
        {'ideas':[{'local_ref':'idea-b','title':'乙'}],
         'runs':[{'local_ref':'run-04','idea_ref':'idea-b','name':'实验 B','status':'failed'}]},
    ]
    class Fake:
        def chat(self, system, user): return json.dumps(replies.pop(0), ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    source = {'filename':'report.md','content':'甲'*8}
    response = client.post(f'/api/projects/{project}/research-evolution/parse', json=source)
    assert response.status_code == 200, response.text
    parsed = response.json(); draft = parsed['draft']
    assert len(draft['ideas']) == 2 and len(draft['runs']) == 2
    assert len({r['local_ref'] for r in draft['runs']}) == 2
    assert all(r['action'] == 'unresolved' for r in draft['runs'])
    assert not draft['edges'][0]['include'] and draft['edges'][0]['linked_run_refs'] == []
    assert not draft['evidence'][0]['include']
    assert any('run-04' in warning for warning in parsed['warnings'])
    payload = {**source,'source_hash':parsed['source_hash'],'draft':draft}
    assert client.post(f'/api/projects/{project}/research-evolution/apply', json=payload).status_code == 422
    for run in draft['runs']: run['action'] = 'new'
    result = client.post(f'/api/projects/{project}/research-evolution/apply', json=payload)
    assert result.status_code == 201, result.text
    assert result.json()['counts']['runs'] == 2 and result.json()['counts']['evidence'] == 0 and result.json()['counts']['edges'] == 0


def test_conflicting_idea_refs_disable_uncertain_relationships(client, monkeypatch):
    from types import SimpleNamespace
    project = client.post('/api/projects', json={'name':'idea ref collision'}).json()['id']
    monkeypatch.setattr('app.routers.research_evolution.get_settings', lambda: SimpleNamespace(segment_max_chars=4, glm_json_parse_retries=0))
    replies=[{'ideas':[{'local_ref':'idea-1','title':'旧方案'}]},
             {'ideas':[{'local_ref':'idea-1','title':'新方案'}], 'runs':[{'local_ref':'run-1','name':'实验','idea_ref':'idea-1','status':'succeeded'}], 'edges':[{'source_ref':'idea-1','target_ref':'idea-1'}]}]
    class Fake:
        def chat(self, system, user): return json.dumps(replies.pop(0), ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    result=client.post(f'/api/projects/{project}/research-evolution/parse', json={'filename':'a.md','content':'甲'*8})
    assert result.status_code == 200, result.text
    draft=result.json()['draft']
    assert len(draft['ideas'])==2 and all(i['action']=='unresolved' for i in draft['ideas'])
    assert draft['runs'][0]['action']=='unresolved' and not draft['edges'][0]['include']
    assert '所属 Idea 引用 idea-1' in draft['runs'][0]['notes']


def test_retry_reuses_only_completed_segments(client, monkeypatch):
    from types import SimpleNamespace
    from app.ai.client import GlmError
    from app.ai import evolution_checkpoints
    project = client.post('/api/projects', json={'name':'retry segments'}).json()['id']
    monkeypatch.setattr('app.routers.research_evolution.get_settings', lambda: SimpleNamespace(segment_max_chars=4, glm_json_parse_retries=0))
    calls=[]
    class Fake:
        base_url='https://checkpoint.test'; model='mock'
        def chat(self, system, user):
            segment=1 if '第 1/2 段' in user else 2
            calls.append(segment)
            if calls == [1,2]: raise GlmError('模拟模型连接中断')
            return json.dumps({'ideas':[{'local_ref':f'idea-{segment}','title':f'方案 {segment}'}]}, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    source={'filename':'retry.md','content':'甲'*8}
    first=client.post(f'/api/projects/{project}/research-evolution/parse', json=source)
    assert first.status_code==422 and '已完成的分段' in first.json()['detail']
    # The backend process may have stopped; only the database survives.
    evolution_checkpoints._reports.clear()
    history = client.get(f'/api/projects/{project}/research-evolution/history').json()
    assert len(history) == 1 and history[0]['status'] == 'incomplete'
    restored = client.get(f'/api/projects/{project}/research-evolution/history/{history[0]["id"]}').json()
    assert restored['content'] == source['content'] and restored['result'] is None
    second=client.post(f'/api/projects/{project}/research-evolution/parse', json=source)
    assert second.status_code==200 and len(second.json()['draft']['ideas'])==2
    assert second.json()['reused_segments']==1
    assert calls==[1,2,2]
    assert not evolution_checkpoints._reports


def test_history_restores_review_and_prevents_repeated_model_calls(client, monkeypatch):
    project = client.post('/api/projects', json={'name':'history review'}).json()['id']
    other = client.post('/api/projects', json={'name':'other history'}).json()['id']
    calls = []
    class Fake:
        base_url='https://history.test'; model='mock'
        def chat(self, system, user):
            calls.append(user)
            return json.dumps({'ideas':[{'local_ref':'idea-1','title':'方案'}]}, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    source={'filename':'history.md','content':'历史报告'}
    first=client.post(f'/api/projects/{project}/research-evolution/parse', json=source).json()
    first['draft']['ideas'][0]['title']='修改后的名称'
    saved=client.put(f'/api/projects/{project}/research-evolution/history', json={**source,'source_hash':first['source_hash'],'result':first})
    assert saved.status_code == 200
    item=client.get(f'/api/projects/{project}/research-evolution/history').json()[0]
    assert item['status']=='review'
    restored=client.get(f'/api/projects/{project}/research-evolution/history/{item["id"]}').json()
    assert restored['result']['draft']['ideas'][0]['title']=='修改后的名称'
    assert client.get(f'/api/projects/{other}/research-evolution/history/{item["id"]}').status_code==404
    again=client.post(f'/api/projects/{project}/research-evolution/parse', json=source).json()
    assert again['draft']['ideas'][0]['title']=='修改后的名称' and len(calls)==1
    applied=client.post(f'/api/projects/{project}/research-evolution/apply', json={**source,'source_hash':again['source_hash'],'draft':again['draft']})
    assert applied.status_code==201
    assert client.get(f'/api/projects/{project}/research-evolution/history').json()[0]['status']=='imported'
    assert client.put(f'/api/projects/{project}/research-evolution/history', json={**source,'source_hash':first['source_hash'],'result':first}).status_code==409
    assert client.post(f'/api/projects/{project}/research-evolution/parse', json=source).status_code==409


def test_repeated_run_keeps_later_details_and_conflicting_metrics_are_not_guessed(client, monkeypatch):
    from types import SimpleNamespace
    project = client.post('/api/projects', json={'name':'merge segments'}).json()['id']
    monkeypatch.setattr('app.routers.research_evolution.get_settings', lambda: SimpleNamespace(segment_max_chars=4, glm_json_parse_retries=0))
    replies=[{'ideas':[{'local_ref':'a','title':'方案'}], 'runs':[{'local_ref':'run-1','idea_ref':'a','name':'对照','status':'succeeded','notes':'第一段','metrics':[{'name':'acc','step':0,'value':0.8}]}]},
             {'runs':[{'local_ref':'run-1','idea_ref':'a','name':'对照','status':'failed','notes':'第二段','metrics':[{'name':'acc','step':0,'value':0.9},{'name':'loss','step':0,'value':0.2}]}]}]
    class Fake:
        def chat(self, system, user): return json.dumps(replies.pop(0), ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    response=client.post(f'/api/projects/{project}/research-evolution/parse', json={'filename':'a.md','content':'甲'*8})
    assert response.status_code == 200, response.text
    run=response.json()['draft']['runs'][0]
    assert run['status'] is None and run['action']=='skip'
    assert '第一段' in run['notes'] and '第二段' in run['notes'] and '0.8 / 0.9' in run['notes']
    assert [m['name'] for m in run['metrics']]==['loss']


def test_conflicting_evidence_is_not_automatically_imported(client, monkeypatch):
    project = client.post('/api/projects', json={'name':'conflicting judgments'}).json()['id']
    result={'ideas':[{'local_ref':'a','title':'方案'}], 'runs':[{'local_ref':'r','idea_ref':'a','name':'实验','status':'succeeded'}],
            'evidence':[{'idea_ref':'a','hypothesis_title':'假设','run_ref':'r','verdict':'supports','note':'观察一'},
                        {'idea_ref':'a','hypothesis_title':'假设','run_ref':'r','verdict':'refutes','note':'观察二'}]}
    class Fake:
        def chat(self, system, user): return json.dumps(result, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    response=client.post(f'/api/projects/{project}/research-evolution/parse', json={'filename':'a.md','content':'报告'})
    assert response.status_code==200
    proofs=response.json()['draft']['evidence']
    assert len(proofs)==2 and all(not proof['include'] for proof in proofs)
    assert any('不同判断' in w for w in response.json()['warnings'])


def test_missing_references_and_names_remain_reviewable(client, monkeypatch):
    project=client.post('/api/projects', json={'name':'missing reference'}).json()['id']
    reply={'ideas':[{'methods':'只有方案，未给名称和编号'}], 'runs':[{'name':'实验','status':'succeeded'}],
           'edges':[{'reason':'思路发生转变'}], 'evidence':[{'hypothesis_title':'假设','verdict':'inconclusive'}]}
    class Fake:
        def chat(self, system, user): return json.dumps(reply, ensure_ascii=False)
    monkeypatch.setattr('app.routers.research_evolution.get_glm_client', lambda: Fake())
    response=client.post(f'/api/projects/{project}/research-evolution/parse', json={'filename':'a.md','content':'没有编号的报告'})
    assert response.status_code==200, response.text
    draft=response.json()['draft']
    assert draft['ideas'][0]['action']=='unresolved' and draft['ideas'][0]['review_flags']
    assert draft['runs'][0]['action']=='unresolved' and draft['runs'][0]['idea_ref']=='__unknown__'
    assert not draft['edges'][0]['include'] and not draft['evidence'][0]['include']
    assert draft['ideas'][0]['methods']=='只有方案，未给名称和编号'
