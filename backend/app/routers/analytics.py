"""Router for analytics endpoints.

Each endpoint performs SQL aggregation queries on the interaction data
populated by the ETL pipeline. All endpoints require a `lab` query
parameter to filter results by lab (e.g., "lab-01").
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import select, func, case
from sqlalchemy import Date, cast
from typing import List

from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models.item import ItemRecord as Item
from app.models.interaction import InteractionLog
from app.models.learner import Learner

router = APIRouter()


async def get_lab_item(lab_param: str, session: AsyncSession) -> Item:
    """Find lab item by lab parameter (lab-04 → Lab 04)."""
    # Extract lab number from "lab-04" → "04"
    lab_number = lab_param.split("-")[-1]
    # Search for "Lab 04" pattern (keep leading zero to match fixture data)
    lab_title = f"Lab {lab_number}"

    result = await session.exec(
        select(Item).where(Item.type == "lab").where(Item.title.contains(lab_title))
    )
    lab_item = result.first()

    if not lab_item:
        raise HTTPException(status_code=404, detail=f"Lab {lab_param} not found")

    return lab_item


async def get_task_ids(lab_item: Item, session: AsyncSession) -> list[int]:
    """Get all task IDs that belong to a lab."""
    result = await session.exec(
        select(Item.id).where(Item.type == "task").where(Item.parent_id == lab_item.id)
    )
    return [task_id for task_id in result.all()]


# ========== 1. SCORES HISTOGRAM ==========
@router.get("/scores")
async def get_scores_histogram(
    lab: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> List[dict]:
    """Return score distribution in four buckets."""
    # Find lab
    lab_item = await get_lab_item(lab, session)

    # Find tasks
    task_ids = await get_task_ids(lab_item, session)

    if not task_ids:
        return [
            {"bucket": "0-25", "count": 0},
            {"bucket": "26-50", "count": 0},
            {"bucket": "51-75", "count": 0},
            {"bucket": "76-100", "count": 0},
        ]

    # Query with CASE for buckets
    bucket_expr = case(
        (InteractionLog.score <= 25, "0-25"),
        (InteractionLog.score <= 50, "26-50"),
        (InteractionLog.score <= 75, "51-75"),
        else_="76-100",
    )

    query = (
        select(bucket_expr.label("bucket"), func.count().label("count"))
        .where(InteractionLog.item_id.in_(task_ids))
        .where(InteractionLog.score.isnot(None))
        .group_by("bucket")
    )

    results = await session.exec(query)
    rows = results.all()

    # Format results - ensure all buckets are present
    buckets = {row[0]: row[1] for row in rows}

    return [
        {"bucket": b, "count": buckets.get(b, 0)}
        for b in ["0-25", "26-50", "51-75", "76-100"]
    ]


# ========== 2. PASS RATES ==========
@router.get("/pass-rates")
async def get_pass_rates(
    lab: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> List[dict]:
    """Return per-task statistics."""
    # Find lab
    lab_item = await get_lab_item(lab, session)

    # Find tasks
    result = await session.exec(
        select(Item).where(Item.type == "task").where(Item.parent_id == lab_item.id)
    )
    tasks = result.all()

    if not tasks:
        return []

    task_ids = [task.id for task in tasks]
    task_titles = {task.id: task.title for task in tasks}

    # Query per-task stats
    query = (
        select(
            InteractionLog.item_id,
            func.round(func.avg(InteractionLog.score), 1).label("avg_score"),
            func.count().label("attempts"),
        )
        .where(InteractionLog.item_id.in_(task_ids))
        .where(InteractionLog.score.isnot(None))
        .group_by(InteractionLog.item_id)
    )

    results = await session.exec(query)
    rows = results.all()

    # Format and sort by task title
    formatted = []
    for item_id, avg_score, attempts in rows:
        formatted.append(
            {
                "task": task_titles[item_id],
                "avg_score": float(avg_score) if avg_score else 0,
                "attempts": attempts,
            }
        )

    formatted.sort(key=lambda x: x["task"])
    return formatted


# ========== 3. TIMELINE ==========
@router.get("/timeline")
async def get_timeline(
    lab: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> List[dict]:
    """Return submissions per day."""
    # Find lab
    lab_item = await get_lab_item(lab, session)

    # Find tasks
    task_ids = await get_task_ids(lab_item, session)

    if not task_ids:
        return []

    # Query by date - use func.strftime for SQLite compatibility
    # strftime('%Y-%m-%d', created_at) extracts date as string
    date_expr = func.strftime("%Y-%m-%d", InteractionLog.created_at).label("date")

    query = (
        select(date_expr, func.count().label("submissions"))
        .where(InteractionLog.item_id.in_(task_ids))
        .group_by(date_expr)
        .order_by(date_expr)
    )

    results = await session.exec(query)
    rows = results.all()

    return [{"date": row[0], "submissions": row[1]} for row in rows]


# ========== 4. GROUPS ==========
@router.get("/groups")
async def get_groups(
    lab: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> List[dict]:
    """Return per-group performance."""
    # Find lab
    lab_item = await get_lab_item(lab, session)

    # Find tasks
    task_ids = await get_task_ids(lab_item, session)

    if not task_ids:
        return []

    # Query with join to learners
    query = (
        select(
            Learner.student_group,
            func.round(func.avg(InteractionLog.score), 1).label("avg_score"),
            func.count(func.distinct(InteractionLog.learner_id)).label("students"),
        )
        .join(InteractionLog, InteractionLog.learner_id == Learner.id)
        .where(InteractionLog.item_id.in_(task_ids))
        .where(InteractionLog.score.isnot(None))
        .group_by(Learner.student_group)
        .order_by(Learner.student_group)
    )

    results = await session.exec(query)
    rows = results.all()

    return [
        {
            "group": row[0] or "Unknown",
            "avg_score": float(row[1]) if row[1] else 0,
            "students": row[2],
        }
        for row in rows
    ]
