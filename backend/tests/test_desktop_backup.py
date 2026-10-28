import sqlite3

from desktop_entry import run_migrations


def test_upgrade_creates_a_consistent_backup_once(tmp_path):
    path = tmp_path / "research_os.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE preserved (value TEXT)")
        db.execute("INSERT INTO preserved VALUES ('original')")
    url = f"sqlite:///{path.as_posix()}"
    run_migrations(url)
    backups = list((tmp_path / "backups").glob("*.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute("SELECT value FROM preserved").fetchone() == ("original",)
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    run_migrations(url)
    assert len(list((tmp_path / "backups").glob("*.db"))) == 1
