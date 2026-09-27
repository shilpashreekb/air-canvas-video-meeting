"""
KNN Gesture Classification Training and Evaluation

Calculates:
- Accuracy
- Precision
- Recall
- F1-score
- Macro average
- Weighted average
- Confusion matrix

Generates:
- Gesture metrics graph
- Confusion matrix graph
- JSON evaluation report
"""

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)

# =========================================================
# PROJECT PATH
# =========================================================

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1])
)

# =========================================================
# PROJECT MODULES
# =========================================================

from app.ml.feature_extraction import FEATURE_COLUMNS

from app.ml.preprocessing import (
    GESTURE_CLASSES,
    build_pipeline,
)

# =========================================================
# K VALUES
# =========================================================

CANDIDATE_K_VALUES = [
    1,
    3,
    5,
    7,
    9,
    11,
    13,
    15,
]


# =========================================================
# LOAD FEATURES AND LABELS
# =========================================================

def load_features_labels(csv_path: Path):

    df = pd.read_csv(csv_path)

    missing = (
        set(FEATURE_COLUMNS + ["label"])
        - set(df.columns)
    )

    if missing:

        raise ValueError(
            f"{csv_path} is missing expected columns: "
            f"{missing}"
        )

    X = df[
        FEATURE_COLUMNS
    ].to_numpy(
        dtype=np.float64
    )

    y = df["label"].to_numpy()

    return X, y


# =========================================================
# MAIN
# =========================================================

def main():

    # =====================================================
    # ARGUMENTS
    # =====================================================

    parser = argparse.ArgumentParser(
        description=__doc__
    )

    parser.add_argument(
        "--custom-dir",
        type=Path,
        default=Path(
            "dataset/custom/processed"
        ),
    )

    parser.add_argument(
        "--public-csv",
        type=Path,
        default=Path(
            "dataset/supplementary/processed_public.csv"
        ),
    )

    parser.add_argument(
        "--model-out",
        type=Path,
        default=Path(
            "models/gesture_knn.joblib"
        ),
    )

    parser.add_argument(
        "--report-out",
        type=Path,
        default=Path(
            "models/evaluation_report.json"
        ),
    )

    args = parser.parse_args()

    # =====================================================
    # DATASET PATHS
    # =====================================================

    train_csv = (
        args.custom_dir / "train.csv"
    )

    val_csv = (
        args.custom_dir / "validation.csv"
    )

    test_csv = (
        args.custom_dir / "test.csv"
    )

    # =====================================================
    # CHECK FILES
    # =====================================================

    for required in (
        train_csv,
        val_csv,
        test_csv,
    ):

        if not required.exists():

            raise SystemExit(
                f"Required file not found: {required}\n"
                "Run the dataset preparation scripts first."
            )

    # =====================================================
    # LOAD DATA
    # =====================================================

    X_train_custom, y_train_custom = (
        load_features_labels(
            train_csv
        )
    )

    X_val, y_val = (
        load_features_labels(
            val_csv
        )
    )

    X_test, y_test = (
        load_features_labels(
            test_csv
        )
    )

    # =====================================================
    # PRINT DATASET INFORMATION
    # =====================================================

    print(
        f"Custom train samples: "
        f"{len(X_train_custom)}"
    )

    print(
        f"Validation samples: "
        f"{len(X_val)}"
    )

    print(
        f"Test samples: "
        f"{len(X_test)}"
    )

    # =====================================================
    # ADD PUBLIC DATA TO TRAINING DATA
    # =====================================================

    if args.public_csv.exists():

        X_train_public, y_train_public = (
            load_features_labels(
                args.public_csv
            )
        )

        X_train = np.vstack(
            [
                X_train_custom,
                X_train_public,
            ]
        )

        y_train = np.concatenate(
            [
                y_train_custom,
                y_train_public,
            ]
        )

        print(
            f"Public supplementary samples added: "
            f"{len(X_train_public)}"
        )

    else:

        X_train = X_train_custom

        y_train = y_train_custom

        print(
            "Public supplementary CSV not found."
        )

    print(
        f"Total training samples: "
        f"{len(X_train)}"
    )

    # =====================================================
    # SELECT BEST K
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "K SELECTION USING VALIDATION SET"
    )

    print(
        "========================================"
    )

    best_k = None

    best_val_accuracy = -1.0

    k_results = {}

    for k in CANDIDATE_K_VALUES:

        if k > len(X_train):

            continue

        pipeline = build_pipeline(
            n_neighbors=k
        )

        pipeline.fit(
            X_train,
            y_train
        )

        val_preds = pipeline.predict(
            X_val
        )

        val_acc = accuracy_score(
            y_val,
            val_preds
        )

        k_results[k] = val_acc

        print(
            f"k={k}: "
            f"{val_acc * 100:.2f}%"
        )

        if val_acc > best_val_accuracy:

            best_val_accuracy = val_acc

            best_k = k

    if best_k is None:

        raise SystemExit(
            "Could not select a valid K."
        )

    print(
        f"\nSelected K = {best_k}"
    )

    print(
        f"Validation Accuracy = "
        f"{best_val_accuracy * 100:.2f}%"
    )

    # =====================================================
    # TRAIN FINAL MODEL
    # =====================================================

    final_pipeline = build_pipeline(
        n_neighbors=best_k
    )

    final_pipeline.fit(
        X_train,
        y_train
    )

    # =====================================================
    # TEST PREDICTIONS
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "FINAL TEST SET EVALUATION"
    )

    print(
        "========================================"
    )

    test_preds = final_pipeline.predict(
        X_test
    )

    # =====================================================
    # LABELS
    # =====================================================

    labels = list(
        GESTURE_CLASSES
    )

    # =====================================================
    # OVERALL ACCURACY
    # =====================================================

    accuracy = accuracy_score(
        y_test,
        test_preds
    )

    # =====================================================
    # CLASSIFICATION REPORT
    # =====================================================

    report_dict = classification_report(
        y_test,
        test_preds,
        labels=labels,
        target_names=labels,
        output_dict=True,
        zero_division=0,
    )

    # =====================================================
    # WEIGHTED METRICS
    # =====================================================

    weighted_precision = precision_score(
        y_test,
        test_preds,
        average="weighted",
        zero_division=0,
    )

    weighted_recall = recall_score(
        y_test,
        test_preds,
        average="weighted",
        zero_division=0,
    )

    weighted_f1 = f1_score(
        y_test,
        test_preds,
        average="weighted",
        zero_division=0,
    )

    # =====================================================
    # MACRO METRICS
    # =====================================================

    macro_precision = precision_score(
        y_test,
        test_preds,
        average="macro",
        zero_division=0,
    )

    macro_recall = recall_score(
        y_test,
        test_preds,
        average="macro",
        zero_division=0,
    )

    macro_f1 = f1_score(
        y_test,
        test_preds,
        average="macro",
        zero_division=0,
    )

    # =====================================================
    # CONFUSION MATRIX
    # =====================================================

    cm = confusion_matrix(
        y_test,
        test_preds,
        labels=labels,
    )

    # =====================================================
    # PRINT OVERALL RESULTS
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "OVERALL RESULTS"
    )

    print(
        "========================================"
    )

    print(
        f"Accuracy  : "
        f"{accuracy * 100:.2f}%"
    )

    print(
        f"Precision : "
        f"{weighted_precision * 100:.2f}%"
    )

    print(
        f"Recall    : "
        f"{weighted_recall * 100:.2f}%"
    )

    print(
        f"F1-score  : "
        f"{weighted_f1 * 100:.2f}%"
    )

    # =====================================================
    # PRINT MACRO RESULTS
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "MACRO AVERAGE"
    )

    print(
        "========================================"
    )

    print(
        f"Precision : "
        f"{macro_precision * 100:.2f}%"
    )

    print(
        f"Recall    : "
        f"{macro_recall * 100:.2f}%"
    )

    print(
        f"F1-score  : "
        f"{macro_f1 * 100:.2f}%"
    )

    # =====================================================
    # CLASS-WISE RESULTS
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "CLASS-WISE RESULTS"
    )

    print(
        "========================================"
    )

    for gesture in labels:

        print(
            f"\n{gesture.upper()}"
        )

        print(
            f"Precision : "
            f"{report_dict[gesture]['precision'] * 100:.2f}%"
        )

        print(
            f"Recall    : "
            f"{report_dict[gesture]['recall'] * 100:.2f}%"
        )

        print(
            f"F1-score  : "
            f"{report_dict[gesture]['f1-score'] * 100:.2f}%"
        )

        print(
            f"Support   : "
            f"{int(report_dict[gesture]['support'])}"
        )

    # =====================================================
    # COMPLETE CLASSIFICATION REPORT
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "CLASSIFICATION REPORT"
    )

    print(
        "========================================"
    )

    print(
        classification_report(
            y_test,
            test_preds,
            labels=labels,
            target_names=labels,
            digits=4,
            zero_division=0,
        )
    )

    # =====================================================
    # CONFUSION MATRIX TERMINAL
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "CONFUSION MATRIX"
    )

    print(
        "========================================"
    )

    print(
        "Label order:"
    )

    print(
        labels
    )

    print()

    print(
        cm
    )

    # =====================================================
    # OUTPUT DIRECTORY
    # =====================================================

    output_dir = Path(
        "models"
    )

    output_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    # =====================================================
    # GRAPH 1
    # PRECISION / RECALL / F1 + OVERALL ACCURACY
    # =====================================================

    precision_values = [
        report_dict[g]["precision"] * 100
        for g in labels
    ]

    recall_values = [
        report_dict[g]["recall"] * 100
        for g in labels
    ]

    f1_values = [
        report_dict[g]["f1-score"] * 100
        for g in labels
    ]

    overall_accuracy = accuracy * 100

    # -----------------------------------------------------
    # BAR POSITIONS
    # -----------------------------------------------------

    x = np.arange(
        len(labels)
    )

    width = 0.25

    plt.figure(
        figsize=(11, 6)
    )

    # -----------------------------------------------------
    # PRECISION
    # -----------------------------------------------------

    bars1 = plt.bar(
        x - width,
        precision_values,
        width,
        label="Precision"
    )

    # -----------------------------------------------------
    # RECALL
    # -----------------------------------------------------

    bars2 = plt.bar(
        x,
        recall_values,
        width,
        label="Recall"
    )

    # -----------------------------------------------------
    # F1-SCORE
    # -----------------------------------------------------

    bars3 = plt.bar(
        x + width,
        f1_values,
        width,
        label="F1-score"
    )

    # -----------------------------------------------------
    # OVERALL ACCURACY
    # -----------------------------------------------------

    accuracy_x = len(labels) + 0.8

    accuracy_bar = plt.bar(
        accuracy_x,
        overall_accuracy,
        width * 1.5,
        label="Overall Accuracy"
    )

    # -----------------------------------------------------
    # X AXIS
    # -----------------------------------------------------

    plt.xticks(
        list(x) + [accuracy_x],
        labels + ["Overall Accuracy"]
    )

    plt.xlabel(
        "Gesture / Overall"
    )

    plt.ylabel(
        "Score (%)"
    )

    plt.title(
        "Gesture Classification Performance"
    )

    # Leave room for percentage labels
    plt.ylim(
        0,
        105
    )

    plt.legend()

    plt.grid(
        axis="y",
        linestyle="--",
        alpha=0.3
    )

    # =====================================================
    # ADD % ABOVE EVERY BAR
    # =====================================================

    def add_percentage_labels(bars):

        for bar in bars:

            height = bar.get_height()

            plt.text(
                bar.get_x()
                + bar.get_width() / 2,

                height + 1,

                f"{height:.2f}%",

                ha="center",

                va="bottom",

                fontsize=9,

                fontweight="bold"
            )

    # Add labels
    add_percentage_labels(
        bars1
    )

    add_percentage_labels(
        bars2
    )

    add_percentage_labels(
        bars3
    )

    add_percentage_labels(
        accuracy_bar
    )

    # =====================================================
    # SAVE GRAPH
    # =====================================================

    plt.tight_layout()

    metrics_graph_path = (
        output_dir
        / "gesture_metrics.png"
    )

    plt.savefig(
        metrics_graph_path,
        dpi=300,
        bbox_inches="tight"
    )

    plt.show()

    plt.close()

    print(
        f"\nMetrics graph saved to:"
        f"\n{metrics_graph_path}"
    )

    # =====================================================
    # GRAPH 2
    # CONFUSION MATRIX
    # =====================================================

    plt.figure(
        figsize=(8, 7)
    )

    # Light blue color map
    im = plt.imshow(
        cm,
        interpolation="nearest",
        cmap="Blues"
    )

    plt.title(
        "Gesture Classification Confusion Matrix"
    )

    plt.colorbar(
        im,
        fraction=0.046,
        pad=0.04
    )

    plt.xticks(
        np.arange(len(labels)),
        labels,
        rotation=45
    )

    plt.yticks(
        np.arange(len(labels)),
        labels
    )

    plt.xlabel(
        "Predicted Gesture"
    )

    plt.ylabel(
        "Actual Gesture"
    )

    # =====================================================
    # NUMBERS INSIDE CONFUSION MATRIX
    # =====================================================

    threshold = (
        cm.max() / 2
        if cm.size
        else 0
    )

    for i in range(
        cm.shape[0]
    ):

        for j in range(
            cm.shape[1]
        ):

            # Dark text on light cells,
            # white text on darker cells
            text_color = (
                "white"
                if cm[i, j] > threshold
                else "black"
            )

            plt.text(
                j,
                i,
                str(cm[i, j]),

                ha="center",

                va="center",

                color=text_color,

                fontsize=12,

                fontweight="bold"
            )

    plt.tight_layout()

    cm_graph_path = (
        output_dir
        / "confusion_matrix.png"
    )

    plt.savefig(
        cm_graph_path,
        dpi=300,
        bbox_inches="tight"
    )

    plt.show()

    plt.close()

    print(
        f"\nConfusion matrix saved to:"
        f"\n{cm_graph_path}"
    )

    # =====================================================
    # SAVE MODEL
    # =====================================================

    args.model_out.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    joblib.dump(
        final_pipeline,
        args.model_out
    )

    print(
        f"\nModel saved to:"
        f"\n{args.model_out}"
    )

    # =====================================================
    # SAVE JSON REPORT
    # =====================================================

    report = {

        "selected_k":
            int(best_k),

        "validation_accuracy":
            float(best_val_accuracy),

        "test_accuracy":
            float(accuracy),

        "test_accuracy_percent":
            float(accuracy * 100),

        "weighted_precision":
            float(weighted_precision),

        "weighted_recall":
            float(weighted_recall),

        "weighted_f1":
            float(weighted_f1),

        "macro_precision":
            float(macro_precision),

        "macro_recall":
            float(macro_recall),

        "macro_f1":
            float(macro_f1),

        "class_wise_metrics":
            {
                gesture:
                    {
                        "precision":
                            float(
                                report_dict[
                                    gesture
                                ][
                                    "precision"
                                ]
                            ),

                        "recall":
                            float(
                                report_dict[
                                    gesture
                                ][
                                    "recall"
                                ]
                            ),

                        "f1_score":
                            float(
                                report_dict[
                                    gesture
                                ][
                                    "f1-score"
                                ]
                            ),

                        "support":
                            int(
                                report_dict[
                                    gesture
                                ][
                                    "support"
                                ]
                            ),
                    }

                for gesture in labels
            },

        "confusion_matrix":
            cm.tolist(),

        "confusion_matrix_labels":
            labels,

        "graphs":
            {
                "gesture_metrics":
                    str(
                        metrics_graph_path
                    ),

                "confusion_matrix":
                    str(
                        cm_graph_path
                    ),
            },
    }

    # =====================================================
    # SAVE JSON
    # =====================================================

    args.report_out.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with open(
        args.report_out,
        "w"
    ) as f:

        json.dump(
            report,
            f,
            indent=4
        )

    print(
        f"\nEvaluation report saved to:"
        f"\n{args.report_out}"
    )

    # =====================================================
    # FINAL SUMMARY
    # =====================================================

    print(
        "\n========================================"
    )

    print(
        "FINAL SUMMARY"
    )

    print(
        "========================================"
    )

    print(
        f"Overall Accuracy : "
        f"{accuracy * 100:.2f}%"
    )

    print(
        f"Weighted Precision: "
        f"{weighted_precision * 100:.2f}%"
    )

    print(
        f"Weighted Recall   : "
        f"{weighted_recall * 100:.2f}%"
    )

    print(
        f"Weighted F1-score : "
        f"{weighted_f1 * 100:.2f}%"
    )

    print(
        "\nFiles generated:"
    )

    print(
        f"1. {metrics_graph_path}"
    )

    print(
        f"2. {cm_graph_path}"
    )

    print(
        f"3. {args.report_out}"
    )

    print(
        f"4. {args.model_out}"
    )


# =========================================================
# RUN PROGRAM
# =========================================================

if __name__ == "__main__":

    main()