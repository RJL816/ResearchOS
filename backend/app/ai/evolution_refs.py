"""Resolve model-generated report references without guessing ambiguous links."""
import json


def _append(old, added):
    if not added or added in (old or ""):
        return old
    return f"{old}\n\n{added}" if old else added


def _name(value):
    return " ".join(value.split()).casefold()


class EvolutionReferences:
    def __init__(self):
        self.ideas = {}
        self.runs = {}
        self.idea_refs = {}
        self.run_refs = {}
        self.edges = []
        self.evidence = []
        self.conflicting_status = set()
        self.conflicting_metrics = set()

    @staticmethod
    def _register(item, registry, output, identity, segment):
        original = item.local_ref
        choices = registry.setdefault(original, [])
        for known_identity, alias in choices:
            if known_identity == identity:
                return alias, False
        alias = original
        if alias in output:
            counter = 1
            while True:
                suffix = f"~s{segment}-{counter}"
                alias = original[:100-len(suffix)] + suffix
                if alias not in output:
                    break
                counter += 1
        choices.append((identity, alias))
        item.local_ref = alias
        output[alias] = item
        return alias, True

    def previous_references(self):
        return {
            "ideas": [{"ref": ref, "names": [self.ideas[alias].title for _, alias in choices]} for ref, choices in self.idea_refs.items()],
            "runs": [{"ref": ref, "names": [self.runs[alias].name for _, alias in choices]} for ref, choices in self.run_refs.items()],
        }

    def add(self, part, segment, fields, warnings):
        for item in part.ideas:
            alias, added = self._register(item, self.idea_refs, self.ideas, _name(item.title), segment)
            if added:
                continue
            prior = self.ideas[alias]
            prior.review_flags.extend(flag for flag in item.review_flags if flag not in prior.review_flags)
            for field in (*fields, "status_reason", "decision_source", "decision_time", "related_evidence"):
                setattr(prior, field, _append(getattr(prior, field), getattr(item, field)))
            prior.hypotheses.extend(h for h in item.hypotheses if not any(v.title == h.title and v.body == h.body for v in prior.hypotheses))
            prior.versions.extend(v for v in item.versions if v not in prior.versions)
            if prior.status and item.status and prior.status != item.status:
                prior.status_reason = _append(prior.status_reason, f"不同段落给出了不同状态：{prior.status} / {item.status}，请核对。")
                prior.status = None
                self.conflicting_status.add(("idea", alias))
                warnings.append(f"Idea {alias} 的状态在不同段落不一致，请人工核对。")
            elif not prior.status and item.status and ("idea", alias) not in self.conflicting_status:
                prior.status = item.status
        for run in part.runs:
            identity = (_name(run.name), run.idea_ref)
            alias, added = self._register(run, self.run_refs, self.runs, identity, segment)
            if added:
                continue
            prior = self.runs[alias]
            prior.review_flags.extend(flag for flag in run.review_flags if flag not in prior.review_flags)
            for field in ("notes", "dataset", "eval_protocol"):
                setattr(prior, field, _append(getattr(prior, field), getattr(run, field)))
            if prior.status and run.status and prior.status != run.status:
                prior.notes = _append(prior.notes, f"不同段落给出了不同实验状态：{prior.status} / {run.status}，请核对。")
                prior.status = None
                self.conflicting_status.add(("run", alias))
                warnings.append(f"实验 {alias} 的状态在不同段落不一致，请人工核对。")
            elif not prior.status and run.status and ("run", alias) not in self.conflicting_status:
                prior.status = run.status
            if prior.params is None:
                prior.params = run.params
            elif run.params is not None and prior.params != run.params:
                prior.notes = _append(prior.notes, "另一段参数：" + json.dumps(run.params, ensure_ascii=False))
                warnings.append(f"实验 {alias} 的参数在不同段落不同，已保留供核对。")
            for metric in run.metrics:
                key = (alias, metric.name, metric.step)
                existing = next((m for m in prior.metrics if m.name == metric.name and m.step == metric.step), None)
                if key in self.conflicting_metrics:
                    prior.notes = _append(prior.notes, f"待核对指标 {metric.name} step {metric.step}: {metric.value}")
                elif existing and existing.value != metric.value:
                    prior.notes = _append(prior.notes, f"待核对指标 {metric.name} step {metric.step}: {existing.value} / {metric.value}")
                    prior.metrics.remove(existing)
                    self.conflicting_metrics.add(key)
                    warnings.append(f"实验 {alias} 的指标 {metric.name} 在不同段落不一致，已移到备注待核对。")
                elif not existing:
                    prior.metrics.append(metric)
        self.edges.extend(part.edges)
        self.evidence.extend(part.evidence)

    @staticmethod
    def _resolve(registry, ref):
        choices = registry.get(ref, [])
        if not choices:
            return ref, "未找到"
        return choices[0][1], "存在多个不同对象" if len(choices) > 1 else None

    def finish(self, warnings):
        for ref, choices in self.idea_refs.items():
            if len(choices) > 1:
                names = "、".join(self.ideas[alias].title for _, alias in choices)
                warnings.append(f"Idea 引用 {ref} 对应多个名称（{names}），请逐项确认是否为不同 Idea。")
                for _, alias in choices:
                    self.ideas[alias].action = "unresolved"
        for ref, choices in self.run_refs.items():
            if len(choices) > 1:
                names = "、".join(self.runs[alias].name for _, alias in choices)
                warnings.append(f"实验引用 {ref} 对应多个实验（{names}），请逐项确认，相关证据和关系默认不导入。")
                for _, alias in choices:
                    self.runs[alias].action = "unresolved"
                    self.runs[alias].notes = _append(self.runs[alias].notes, f"原引用 {ref} 对应多个实验，请核对是否重复。")
        for run in self.runs.values():
            original = run.idea_ref
            run.idea_ref, problem = self._resolve(self.idea_refs, original)
            if problem:
                run.action = "unresolved"
                run.notes = _append(run.notes, f"所属 Idea 引用 {original} {problem}，请重新选择所属 Idea。")
                warnings.append(f"实验 {run.name} 的所属 Idea 引用 {original} {problem}，请确认。")
        for edge in self.edges:
            issues = []
            for field in ("source_ref", "target_ref"):
                original = getattr(edge, field)
                resolved, problem = self._resolve(self.idea_refs, original)
                setattr(edge, field, resolved)
                if problem: issues.append(f"Idea {original} {problem}")
            valid_runs = []
            for original in edge.linked_run_refs:
                resolved, problem = self._resolve(self.run_refs, original)
                if problem: issues.append(f"实验 {original} {problem}")
                elif resolved not in valid_runs: valid_runs.append(resolved)
            edge.linked_run_refs = valid_runs
            if issues:
                edge.include = False
                note = "关联待确认：" + "；".join(issues)
                edge.trigger_description = _append(edge.trigger_description, note)
                warnings.append("演化关系" + note + "，默认不导入，请核对。")
        for proof in self.evidence:
            issues = []
            for field, registry, label in (("idea_ref", self.idea_refs, "Idea"), ("run_ref", self.run_refs, "实验")):
                original = getattr(proof, field)
                resolved, problem = self._resolve(registry, original)
                setattr(proof, field, resolved)
                if problem: issues.append(f"{label} {original} {problem}")
            if issues:
                proof.include = False
                note = "关联待确认：" + "；".join(issues)
                proof.note = _append(proof.note, note)
                warnings.append("证据" + note + "，默认不导入，请核对。")

        # A single hypothesis/experiment pair can hold one judgment. Preserve
        # contradictory judgments for manual review rather than overwriting one.
        grouped = {}
        unique = []
        for proof in self.evidence:
            key = (proof.idea_ref, _name(proof.hypothesis_title), proof.run_ref)
            previous = grouped.setdefault(key, [])
            same = next((item for item in previous if item.verdict == proof.verdict), None)
            if same:
                same.note = _append(same.note, proof.note)
                same.include = same.include and proof.include
            else:
                if previous:
                    for item in previous:
                        item.include = False
                        item.note = _append(item.note, "同一实验与假设存在不同判断，请人工核对。")
                    proof.include = False
                    proof.note = _append(proof.note, "同一实验与假设存在不同判断，请人工核对。")
                    warnings.append(f"假设 {proof.hypothesis_title} 与实验 {proof.run_ref} 存在不同判断，默认不导入。")
                previous.append(proof)
                unique.append(proof)
        self.evidence = unique
